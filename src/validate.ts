/**
 * Pre-flight validation for `up` (and friends).
 *
 * Checks fall into three buckets:
 *   - **Hard errors** — Lima missing/too old, profile lima.yaml missing,
 *     malformed project override, provisioning that references paths only
 *     attached after cache-clone (which would silently fail on cache build).
 *   - **Warnings** — env vars on the allowlist that aren't set in the
 *     current shell; profile configMount source dirs that don't exist yet.
 *   - **Info** — applied project lima overrides (cpus/memory/disk).
 *
 * `printValidation` renders the result with light ANSI colors when stderr
 * is a TTY and returns `false` only when hard errors were emitted.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildLimaConfig,
  GUEST_WORKDIR,
  loadProjectOverride,
  mountPointFor,
  PROJECT_LIMA_PATH,
  provisionFilePaths,
} from './template.ts';
import type { LimaConfig, Profile, ValidationResult } from './types.ts';

const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MIN_LIMA_VERSION = '2.0.3';

function parseLimaVersion(versionString: string | null | undefined): string | null {
  const match = (versionString || '').match(/(\d+\.\d+\.\d+)/);
  return match ? match[1] : null;
}

function isVersionAtLeast(version: string, minimum: string): boolean {
  const v = version.split('.').map(Number);
  const m = minimum.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (v[i] > m[i]) return true;
    if (v[i] < m[i]) return false;
  }
  return true;
}

function validateConfig(profile: Profile, projectDir: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const info: string[] = [];

  const limaCheck = spawnSync('limactl', ['--version'], {
    encoding: 'utf-8',
    stdio: 'pipe',
  });
  const spawnError = limaCheck.error;
  if (spawnError && 'code' in spawnError && spawnError.code === 'ENOENT') {
    errors.push('limactl not found. Install Lima first: https://lima-vm.io');
  } else {
    const version = parseLimaVersion(limaCheck.stdout);
    if (version && !isVersionAtLeast(version, MIN_LIMA_VERSION)) {
      errors.push(
        `Lima ${version} is too old. Minimum required version is ${MIN_LIMA_VERSION}. ` +
          'Update Lima: https://lima-vm.io',
      );
    }
  }

  if (!existsSync(profile.limaPath)) {
    errors.push(`Profile "${profile.name}" is missing ${profile.limaPath}`);
  }

  try {
    loadProjectOverride(projectDir);
  } catch (err: unknown) {
    errors.push(err instanceof Error ? err.message : String(err));
  }

  for (const varName of profile.shellEnvAllowlist) {
    if (!ENV_NAME_RE.test(varName)) {
      errors.push(`Invalid environment variable name "${varName}" in ` + `${profile.dir}/env.yaml`);
      continue;
    }

    if (!process.env[varName]) {
      warnings.push(
        `Environment variable ${varName} is not set; it will not be available in the VM shell`,
      );
    }
  }

  for (const mount of profile.configMounts) {
    const hostPath = join(profile.dir, mount.source);
    if (!existsSync(hostPath)) {
      warnings.push(
        `No profile config directory found at ${hostPath}; ${mount.guestTarget} will start empty`,
      );
    }
  }

  errors.push(...validateCacheSafeProvisioning(profile, projectDir));

  const projectOverridePath = `${projectDir}/${PROJECT_LIMA_PATH}`;
  if (existsSync(projectOverridePath)) {
    try {
      const override = loadProjectOverride(projectDir);
      const keys = Object.keys(override);
      if (keys.length > 0) {
        const summary = keys.map((k) => `${k}=${override[k as keyof typeof override]}`).join(', ');
        info.push(`Project override applied: ${summary}`);
      }
    } catch {
      // loadProjectOverride errors are already captured above
    }
  }

  return { errors, warnings, info };
}

function validateCacheSafeProvisioning(profile: Profile, projectDir: string): string[] {
  const errors: string[] = [];
  let config: LimaConfig;
  try {
    config = buildLimaConfig(profile, projectDir);
  } catch {
    return errors;
  }

  const cacheUnsafePaths = [
    GUEST_WORKDIR,
    ...(profile.configMounts || []).map((mount) => mountPointFor(mount)),
  ];

  for (const file of provisionFilePaths(config)) {
    let content: string;
    try {
      content = readFileSync(file, 'utf-8');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`Could not read provisioning file ${file}: ${message}`);
      continue;
    }

    const cacheUnsafePath = findCacheUnsafePath(content, cacheUnsafePaths);
    if (cacheUnsafePath) {
      errors.push(
        `Provisioning file ${file} references ${cacheUnsafePath}, but profile cache provisioning runs before project/config mounts are attached. Move project- or config-specific setup to profile finalization instead.`,
      );
    }
  }

  for (const [index, provision] of (config.provision || []).entries()) {
    if (typeof provision?.script !== 'string') {
      continue;
    }
    const cacheUnsafePath = findCacheUnsafePath(provision.script, cacheUnsafePaths);
    if (cacheUnsafePath) {
      errors.push(
        `Inline provisioning script provision[${index}] references ${cacheUnsafePath}, but profile cache provisioning runs before project/config mounts are attached. Move project- or config-specific setup to profile finalization instead.`,
      );
    }
  }

  return errors;
}

function findCacheUnsafePath(content: string, cacheUnsafePaths: string[]): string | undefined {
  return cacheUnsafePaths.find((cacheUnsafePath) => content.includes(cacheUnsafePath));
}

function printValidation({ errors, warnings, info = [] }: ValidationResult): boolean {
  const useColor = process.stderr.isTTY;
  const red = useColor ? '[31m' : '';
  const yellow = useColor ? '[33m' : '';
  const reset = useColor ? '[0m' : '';

  for (const message of info) {
    console.log(`Info: ${message}`);
  }

  for (const warning of warnings) {
    console.warn(`${yellow}Warning:${reset} ${warning}`);
  }

  for (const error of errors) {
    console.error(`${red}Error:${reset} ${error}`);
  }

  if ((info.length > 0 || warnings.length > 0) && errors.length === 0) {
    console.log('');
  }

  return errors.length === 0;
}

export {
  findCacheUnsafePath,
  isVersionAtLeast,
  MIN_LIMA_VERSION,
  parseLimaVersion,
  printValidation,
  validateConfig,
};
