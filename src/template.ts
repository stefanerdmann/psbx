/**
 * Lima YAML rendering pipeline.
 *
 * Builds the effective `lima.yaml` for a project VM by merging the profile
 * Lima YAML with a small project-level override (`<project>/.psbx/
 * lima.yaml`, limited to `cpus`/`memory`/`disk`) and layering the single
 * dynamic mount (the project workdir). Profile configMounts are not mounted;
 * their contents are pushed into the guest home at finalize time (see
 * finalize.ts). The "cache" YAML variant also excludes the workdir mount so
 * that two projects sharing a profile share one content-addressed cache VM.
 *
 * Also exposes the canonical guest-side paths (`GUEST_HOME`,
 * `GUEST_WORKDIR`) so other modules don't hardcode them.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import YAML from 'yaml';
import { deepMerge, expandHome } from './config.ts';
import type { LimaConfig, LimaMount, Profile } from './types.ts';
import { expandTilde } from './utils.ts';

type ProjectOverride = Partial<Pick<LimaConfig, 'cpus' | 'memory' | 'disk'>>;

const GUEST_HOME = '/home/agent';
const GUEST_WORKDIR = `${GUEST_HOME}/workdir`;
const GUEST_PROJECT_AGENT_DIR = `${GUEST_WORKDIR}/.agents`;
const PROJECT_LIMA_PATH = join('.psbx', 'lima.yaml');
const PROJECT_OVERRIDE_KEYS = new Set(['cpus', 'memory', 'disk']);

function expandGuestHome(p: string): string;
function expandGuestHome<T>(p: T): T;
function expandGuestHome(p: unknown): unknown {
  return expandTilde(p, GUEST_HOME);
}

function readYamlObject<T extends Record<string, unknown> = Record<string, unknown>>(
  filepath: string,
): T {
  const raw = readFileSync(filepath, 'utf-8');
  return parseYamlObject<T>(raw, filepath);
}

function parseYamlObject<T extends Record<string, unknown> = Record<string, unknown>>(
  raw: string,
  label: string,
): T {
  const parsed = (YAML.parse(raw) || {}) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} must contain a YAML object`);
  }
  return parsed as T;
}

function loadProjectOverride(projectDir: string): ProjectOverride {
  const overridePath = join(projectDir, PROJECT_LIMA_PATH);
  if (!existsSync(overridePath)) {
    return {};
  }

  const override = readYamlObject<ProjectOverride>(overridePath);
  const invalidKeys = Object.keys(override).filter((key) => !PROJECT_OVERRIDE_KEYS.has(key));

  if (invalidKeys.length > 0) {
    throw new Error(
      `${overridePath} can only override: ${[...PROJECT_OVERRIDE_KEYS].join(', ')}. ` +
        `Unsupported key(s): ${invalidKeys.join(', ')}`,
    );
  }

  validateProjectOverrideValues(override, overridePath);
  return override;
}

function validateProjectOverrideValues(override: ProjectOverride, overridePath: string): void {
  const cpus = override.cpus;
  if (cpus !== undefined && (typeof cpus !== 'number' || !Number.isInteger(cpus) || cpus < 1)) {
    throw new Error(`${overridePath} field "cpus" must be a positive integer`);
  }

  for (const key of ['memory', 'disk'] as const) {
    const value = override[key];
    if (
      value !== undefined &&
      (typeof value !== 'string' || !/^\d+(B|KB|MB|GB|TB|KiB|MiB|GiB|TiB)$/.test(value))
    ) {
      throw new Error(`${overridePath} field "${key}" must be a Lima size string such as "8GiB"`);
    }
  }
}

function normalizeProvisionFiles(config: LimaConfig, profileDir: string): void {
  if (!Array.isArray(config.provision)) {
    return;
  }

  for (const provision of config.provision) {
    if (
      !provision ||
      typeof provision !== 'object' ||
      typeof provision.file !== 'string' ||
      !provision.file
    ) {
      continue;
    }

    const file = expandHome(provision.file);
    provision.file = isAbsolute(file) ? file : resolve(profileDir, file);
  }
}

function addOrReplaceMount(config: LimaConfig, mount: LimaMount): void {
  const mounts = Array.isArray(config.mounts) ? config.mounts : [];
  config.mounts = [
    ...mounts.filter((existing) => existing?.mountPoint !== mount.mountPoint),
    mount,
  ];
}

function addDynamicMounts(config: LimaConfig, projectDir: string): void {
  addOrReplaceMount(config, {
    location: projectDir,
    mountPoint: GUEST_WORKDIR,
    writable: true,
  });
  // Note: profile configMounts are NOT mounted into the guest. Their contents
  // are pushed directly into the guest home at finalize time via `limactl
  // copy` (see copyConfigMountsToGuest in finalize.ts), which resolves any
  // escaping symlinks on the host. This keeps the rendered lima.yaml (and thus
  // limaConfigHash / the profile cache key) independent of per-VM staging
  // paths.
}

function buildLimaConfig(profile: Profile, projectDir: string): LimaConfig {
  const config = buildCacheLimaConfig(profile, projectDir);
  addDynamicMounts(config, projectDir);

  return config;
}

function buildCacheLimaConfig(profile: Profile, projectDir?: string): LimaConfig {
  const profileConfig = readYamlObject<LimaConfig>(profile.limaPath);
  const projectOverride = projectDir ? loadProjectOverride(projectDir) : {};
  const config = deepMerge(profileConfig, projectOverride) as LimaConfig;

  normalizeProvisionFiles(config, profile.dir);

  return config;
}

function stringifyLimaConfig(config: LimaConfig): string {
  return YAML.stringify(config, {
    lineWidth: 0,
  });
}

function buildLimaYaml(profile: Profile, projectDir: string): string {
  return stringifyLimaConfig(buildLimaConfig(profile, projectDir));
}

function buildCacheLimaYaml(profile: Profile, projectDir?: string): string {
  return stringifyLimaConfig(buildCacheLimaConfig(profile, projectDir));
}

function buildProjectInstanceLimaYaml(instanceYamlContent: string, projectDir: string): string {
  const config = parseYamlObject<LimaConfig>(instanceYamlContent, 'instance lima.yaml');
  addDynamicMounts(config, projectDir);

  return stringifyLimaConfig(config);
}

function provisionFilePaths(config: LimaConfig): string[] {
  if (!Array.isArray(config.provision)) {
    return [];
  }
  return config.provision
    .map((provision) => provision?.file)
    .filter((file): file is string => typeof file === 'string' && Boolean(file));
}

function writeLimaYaml(profile: Profile, projectDir: string, outputPath: string): string {
  const yamlContent = buildLimaYaml(profile, projectDir);
  writeFileSync(outputPath, yamlContent, 'utf-8');
  return outputPath;
}

export {
  buildCacheLimaConfig,
  buildCacheLimaYaml,
  buildLimaConfig,
  buildLimaYaml,
  buildProjectInstanceLimaYaml,
  expandGuestHome,
  GUEST_HOME,
  GUEST_PROJECT_AGENT_DIR,
  GUEST_WORKDIR,
  loadProjectOverride,
  PROJECT_LIMA_PATH,
  PROJECT_OVERRIDE_KEYS,
  provisionFilePaths,
  stringifyLimaConfig,
  writeLimaYaml,
};
