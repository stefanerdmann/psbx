/**
 * Application and profile configuration.
 *
 * Owns:
 *   - Resolution of the psbx home directory (`~/.psbx` or
 *     `$PSBX_HOME`) and the layout below it (`config.json`,
 *     `profiles/<name>/{lima,env}.yaml`).
 *   - Loading and validating profile `env.yaml` (the strict psbx
 *     schema for default cmd, allowlist, and config mounts).
 *   - Deriving a deterministic VM name from a project directory.
 *   - Reading and updating the user-level `defaultProfile` setting.
 *
 * Lima YAML loading and merging lives in `template.ts`; this module only
 * touches profile metadata in `env.yaml` and the top-level `config.json`.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import YAML from 'yaml';
import type { AppConfig, ConfigMount, EnvConfig, Profile, SessionMount } from './types.ts';
import { expandTilde, isPlainObject } from './utils.ts';

const DEFAULT_CONFIG: AppConfig = {
  defaultProfile: null,
};

function getConfigDir(): string {
  if (process.env.PSBX_HOME) {
    return resolve(expandHome(process.env.PSBX_HOME));
  }
  return resolve(homedir(), '.psbx');
}

function getConfigPath(): string {
  return join(getConfigDir(), 'config.json');
}

const LIMA_FILE = 'lima.yaml';
const ENV_FILE = 'env.yaml';

/**
 * Recursive merge: nested plain objects are merged key-by-key; everything
 * else (arrays, primitives, null) is replaced wholesale by the source.
 */
function deepMerge<T extends object, U extends Record<string, unknown>>(
  target: T,
  source: U,
): T & U;
function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...target };
  for (const key of Object.keys(source || {})) {
    const targetVal = target[key];
    const sourceVal = source?.[key];
    if (isPlainObject(targetVal) && isPlainObject(sourceVal)) {
      result[key] = deepMerge(targetVal, sourceVal);
    } else {
      result[key] = sourceVal;
    }
  }
  return result;
}

/** Expand a leading `~` / `~/` in a string against the host home directory. */
function expandHome(filepath: string): string;
function expandHome<T>(filepath: T): T;
function expandHome(filepath: unknown): unknown {
  return expandTilde(filepath, homedir());
}

function assertRelativeSubpath(value: string, label: string): void {
  if (value.startsWith('/') || value.split(/[/]+/).includes('..')) {
    throw new Error(`${label} must be a relative path inside its parent directory`);
  }
}

/**
 * The guest user's home directory. Mirrors `GUEST_HOME` in `template.ts`;
 * duplicated here to avoid a circular import (`template.ts` imports this
 * module). Keep the two in sync.
 */
const GUEST_HOME = '/home/agent';

/**
 * Reject shell metacharacters in profile-derived paths that feed
 * `sudo`/root operations (shadowPaths) or `mkdir -p`/`cp -a` (guestTarget).
 * These paths are already `shellQuote`d when injected into generated scripts,
 * so this is defense-in-depth that locks the invariant S3/S4 rely on.
 */
const SHELL_META = /[;&|$`\\"'<>(){}[\]*?!\n\r\t]/;
function assertNoShellMeta(value: string, label: string): void {
  if (SHELL_META.test(value)) {
    throw new Error(`${label} must not contain shell metacharacters`);
  }
}

/**
 * Confine a `configMounts[].guestTarget`. Unlike other profile paths it is
 * allowed to be absolute, but only within the guest home, and it must never
 * contain `..` segments (the finalizer runs `mkdir -p`/`cp -a` against it).
 * Accepts `~`, `~/<relative>`, or an absolute path under the guest home.
 */
function assertGuestTarget(value: string, label: string): void {
  assertNoShellMeta(value, label);
  if (value.split(/[/]+/).includes('..')) {
    throw new Error(`${label} must not contain '..' segments`);
  }
  if (value === '~' || value.startsWith('~/')) {
    return;
  }
  if (value !== GUEST_HOME && !value.startsWith(`${GUEST_HOME}/`)) {
    throw new Error(
      `${label} must be '~', '~/<path>', or an absolute path under ${GUEST_HOME} (got "${value}")`,
    );
  }
}

function loadConfig(): AppConfig {
  const configPath = getConfigPath();
  let userConfig: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(readFileSync(configPath, 'utf-8')) as unknown;
    if (isPlainObject(parsed)) {
      userConfig = parsed;
    }
  } catch (err: unknown) {
    if (!(err instanceof Error && 'code' in err && err.code === 'ENOENT')) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Could not parse ${configPath}: ${message}`);
    }
  }

  return deepMerge(
    DEFAULT_CONFIG as unknown as Record<string, unknown>,
    userConfig,
  ) as unknown as AppConfig;
}

function getProfilesDir(): string {
  return join(getConfigDir(), 'profiles');
}

function validateEnv(parsed: unknown, label: string): EnvConfig {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} must contain a mapping`);
  }

  const envData = parsed as Record<string, unknown>;

  let defaultCmd: string | undefined;
  if (envData.defaultCmd !== undefined && envData.defaultCmd !== null) {
    if (typeof envData.defaultCmd !== 'string' || !envData.defaultCmd) {
      throw new Error(`${label}: defaultCmd must be a non-empty string`);
    }
    defaultCmd = envData.defaultCmd;
  }

  const rawAllowlist = envData.shellEnvAllowlist;
  const shellEnvAllowlist = Array.isArray(rawAllowlist)
    ? rawAllowlist.filter((v): v is string => typeof v === 'string' && Boolean(v))
    : [];

  const rawMounts = envData.configMounts;
  if (!Array.isArray(rawMounts) || rawMounts.length === 0) {
    throw new Error(`${label}: configMounts must be a non-empty array`);
  }

  const seenNames = new Set<string>();
  const configMounts = rawMounts.map((entry, idx): ConfigMount => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`${label}: configMounts[${idx}] must be an object`);
    }

    const mount = entry as Record<string, unknown>;
    const { source, name, guestTarget } = mount;
    if (typeof source !== 'string' || !source) {
      throw new Error(`${label}: configMounts[${idx}].source must be a non-empty string`);
    }
    assertRelativeSubpath(source, `${label}: configMounts[${idx}].source`);
    if (typeof name !== 'string' || !/^[A-Za-z0-9._-]+$/.test(name)) {
      throw new Error(
        `${label}: configMounts[${idx}].name must match [A-Za-z0-9._-]+ (got "${name}")`,
      );
    }
    if (seenNames.has(name)) {
      throw new Error(`${label}: duplicate configMounts.name "${name}"`);
    }
    seenNames.add(name);
    if (typeof guestTarget !== 'string' || !guestTarget) {
      throw new Error(`${label}: configMounts[${idx}].guestTarget must be a non-empty string`);
    }
    assertGuestTarget(guestTarget, `${label}: configMounts[${idx}].guestTarget`);

    const normalized: ConfigMount = { source, name, guestTarget };

    const exfiltrateExcludes = mount.exfiltrateExcludes;
    if (exfiltrateExcludes !== undefined) {
      if (
        !Array.isArray(exfiltrateExcludes) ||
        exfiltrateExcludes.some((s) => typeof s !== 'string' || !s)
      ) {
        throw new Error(
          `${label}: configMounts[${idx}].exfiltrateExcludes must be an array of non-empty strings`,
        );
      }
      for (const [excludeIdx, exclude] of exfiltrateExcludes.entries()) {
        assertRelativeSubpath(
          exclude,
          `${label}: configMounts[${idx}].exfiltrateExcludes[${excludeIdx}]`,
        );
      }
      normalized.exfiltrateExcludes = [...exfiltrateExcludes];
    }

    const driftDetectionExcludes = mount.driftDetectionExcludes;
    if (driftDetectionExcludes !== undefined) {
      if (
        !Array.isArray(driftDetectionExcludes) ||
        driftDetectionExcludes.some((s) => typeof s !== 'string' || !s)
      ) {
        throw new Error(
          `${label}: configMounts[${idx}].driftDetectionExcludes must be an array of non-empty strings`,
        );
      }
      for (const [excludeIdx, exclude] of driftDetectionExcludes.entries()) {
        assertRelativeSubpath(
          exclude,
          `${label}: configMounts[${idx}].driftDetectionExcludes[${excludeIdx}]`,
        );
      }
      normalized.driftDetectionExcludes = [...driftDetectionExcludes];
    }

    return normalized;
  });

  const rawSessions = envData.sessions;
  let sessions: SessionMount[] = [];
  if (rawSessions !== undefined && rawSessions !== null) {
    if (!Array.isArray(rawSessions)) {
      throw new Error(`${label}: sessions must be an array`);
    }
    sessions = rawSessions.map((entry, idx): SessionMount => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        throw new Error(`${label}: sessions[${idx}] must be an object`);
      }
      const sess = entry as Record<string, unknown>;
      const workspacePath = sess.workspacePath;
      if (typeof workspacePath !== 'string' || !workspacePath) {
        throw new Error(`${label}: sessions[${idx}].workspacePath must be a non-empty string`);
      }
      assertRelativeSubpath(workspacePath, `${label}: sessions[${idx}].workspacePath`);
      const guestSymlink = sess.guestSymlink;
      if (guestSymlink !== undefined && (typeof guestSymlink !== 'string' || !guestSymlink)) {
        throw new Error(`${label}: sessions[${idx}].guestSymlink must be a non-empty string`);
      }
      return { workspacePath, ...(guestSymlink ? { guestSymlink } : {}) };
    });
  }

  const rawShadowPaths = envData.shadowPaths;
  let shadowPaths: string[] = [];
  if (rawShadowPaths !== undefined && rawShadowPaths !== null) {
    if (!Array.isArray(rawShadowPaths)) {
      throw new Error(`${label}: shadowPaths must be an array`);
    }
    const seenShadow = new Set<string>();
    for (const [idx, entry] of rawShadowPaths.entries()) {
      if (typeof entry !== 'string' || !entry) {
        throw new Error(`${label}: shadowPaths[${idx}] must be a non-empty string`);
      }
      assertRelativeSubpath(entry, `${label}: shadowPaths[${idx}]`);
      assertNoShellMeta(entry, `${label}: shadowPaths[${idx}]`);
      if (seenShadow.has(entry)) {
        throw new Error(`${label}: duplicate shadowPaths entry "${entry}"`);
      }
      seenShadow.add(entry);
    }
    shadowPaths = [...rawShadowPaths];
  }

  return { defaultCmd, shellEnvAllowlist, configMounts, sessions, shadowPaths };
}

function loadEnv(profileDir: string): EnvConfig {
  const envPath = join(profileDir, ENV_FILE);
  if (!existsSync(envPath)) {
    throw new Error(`Profile is missing ${ENV_FILE} at ${envPath}`);
  }

  let parsed: unknown;
  try {
    parsed = YAML.parse(readFileSync(envPath, 'utf-8'));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not parse ${envPath}: ${message}`);
  }

  return validateEnv(parsed, envPath);
}

function resolveProfile(config: AppConfig, profileNameOverride?: string | null): Profile {
  const name = profileNameOverride || config.defaultProfile;
  if (!name) {
    throw new Error(
      'No profile specified and no default profile configured.\n' +
        'Use `--profile <name>` or set a default with `psbx profile set-default <name>`.',
    );
  }
  const dir = join(getProfilesDir(), name);
  const limaPath = join(dir, LIMA_FILE);

  if (!existsSync(dir)) {
    throw new Error(
      `Profile "${name}" not found at ${dir}. Run \`psbx profile init ${name}\` first.`,
    );
  }

  const { defaultCmd, shellEnvAllowlist, configMounts, sessions, shadowPaths } = loadEnv(dir);

  return {
    name,
    dir,
    limaPath,
    defaultCmd,
    shellEnvAllowlist,
    configMounts,
    sessions,
    shadowPaths,
  };
}

function getVmName(dir: string = process.cwd()): string {
  const base = basename(dir);
  const sanitized = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (!sanitized) {
    throw new Error(
      `Cannot derive VM name from directory "${base}". ` +
        'Use a directory name with at least one alphanumeric character.',
    );
  }

  return sanitized;
}

function saveConfig(config: AppConfig): void {
  const configPath = getConfigPath();
  let existing: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(readFileSync(configPath, 'utf-8')) as unknown;
    if (isPlainObject(parsed)) {
      existing = parsed;
    }
  } catch {
    existing = {};
  }

  const raw: Record<string, unknown> = { ...existing };
  if (config.defaultProfile) {
    raw.defaultProfile = config.defaultProfile;
  } else {
    delete raw.defaultProfile;
  }
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, `${JSON.stringify(raw, null, 2)}\n`, 'utf-8');
}

function setDefaultProfile(profileName: string): AppConfig {
  const config = loadConfig();
  const profileDir = join(getProfilesDir(), profileName);
  if (!existsSync(profileDir)) {
    throw new Error(
      `Profile "${profileName}" not found at ${profileDir}. Run \`psbx profile init ${profileName}\` first.`,
    );
  }
  config.defaultProfile = profileName;
  saveConfig(config);
  return config;
}

export {
  assertRelativeSubpath,
  DEFAULT_CONFIG,
  deepMerge,
  ENV_FILE,
  expandHome,
  getConfigDir,
  getConfigPath,
  getProfilesDir,
  getVmName,
  LIMA_FILE,
  loadConfig,
  loadEnv,
  resolveProfile,
  saveConfig,
  setDefaultProfile,
  validateEnv,
};
