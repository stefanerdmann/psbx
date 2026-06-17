/**
 * The profile is staged to a hidden sibling directory and atomically
 * renamed into place so that an interrupted init never leaves a partial
 * profile in `profiles/`.
 */

export const DESCRIPTION = 'Initialize a psbx profile';

export const HELP_TEXT =
  'Creates a new profile from a shipped template, an existing profile, or\n' +
  'the bundled self-test template. Host config can be optionally copied or\n' +
  'symlinked into the new profile for users who already have a configured\n' +
  'agent on the host.';

import {
  cpSync,
  type Dirent,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import {
  getConfigPath,
  getProfilesDir,
  loadConfig,
  loadEnv,
  setDefaultProfile,
} from '../config.ts';
import { limaGenerateJsonSchema } from '../lima.ts';
import type { AppConfig, ConfigMount } from '../types.ts';
import { copyDirWithResolvedSymlinks, errorMessage, packageRoot } from '../utils.ts';
import { handleError } from './helpers.ts';

export interface InitOptions {
  fromProfile?: string;
  template?: string;
  selfTest?: boolean;
  copyFromHost?: boolean;
  symlinkFromHost?: boolean;
  setAsDefault?: boolean;
}

const TEMPLATE_PROFILES_DIR = resolve(packageRoot(), 'templates', 'profiles');

function ensureConfig(): AppConfig {
  const configPath = getConfigPath();
  if (existsSync(configPath)) {
    return loadConfig();
  }
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, `${JSON.stringify({}, null, 2)}\n`, 'utf-8');
  return loadConfig();
}

function copyProfileTemplate(sourceDir: string, targetDir: string): void {
  cpSync(sourceDir, targetDir, {
    recursive: true,
    dereference: false,
    errorOnExist: true,
    force: false,
  });
  // Pre-create empty source dirs declared by the profile manifest so users
  // know where to drop config files, and so dynamic mounts can attach.
  const { configMounts } = loadEnv(targetDir);
  for (const mount of configMounts) {
    mkdirSync(join(targetDir, mount.source), { recursive: true });
  }
}

function addSchemaHeader(limaPath: string): void {
  const header = '# yaml-language-server: $schema=./lima.schema.json\n';
  const content = readFileSync(limaPath, 'utf-8');
  if (!content.startsWith(header)) {
    writeFileSync(limaPath, header + content, 'utf-8');
  }
}

function generateSchema(profileDir: string): void {
  try {
    const schema = limaGenerateJsonSchema();
    writeFileSync(join(profileDir, 'lima.schema.json'), schema, 'utf-8');
  } catch (err: unknown) {
    console.warn(`Warning: Could not generate Lima JSON schema: ${errorMessage(err)}`);
  }
}

const DEFAULT_TEMPLATE = 'pi-in-ubuntu';
const SHIPPED_TEMPLATES = new Set([
  DEFAULT_TEMPLATE,
  'copilot-in-ubuntu',
  'opencode-in-ubuntu',
  'self-test',
]);

/**
 * Derive the host-side config directory for a config mount by expanding its
 * guestTarget with the *host* home directory (e.g. `~/.pi/agent` →
 * `/home/user/.pi/agent`).
 */
function hostDirForMount(mount: ConfigMount): string {
  const gt = mount.guestTarget;
  if (gt === '~') return homedir();
  if (gt.startsWith('~/')) return join(homedir(), gt.slice(2));
  return gt;
}

/**
 * Walk `rootDir` and warn about any symlink whose target resolves outside
 * `rootDir`. `--copy-from-host` copies with `dereference: true`, so such a
 * link silently pulls external content (e.g. a linked `~/.ssh/id_*` or a
 * credentials file) into the profile and later into the VM. The excludes are
 * opt-in and path-specific, so unknown links would otherwise leak by default.
 */
function warnOnEscapingSymlinks(rootDir: string): void {
  let realRoot: string;
  try {
    realRoot = realpathSync(rootDir);
  } catch {
    return;
  }
  const prefix = realRoot + sep;
  const walk = (dir: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        let resolved: string;
        try {
          resolved = realpathSync(full);
        } catch {
          continue;
        }
        if (resolved !== realRoot && !resolved.startsWith(prefix)) {
          console.warn(
            `Warning: ${full} is a symlink pointing outside the source directory (${resolved}); ` +
              'its contents were copied into the profile. Review before sharing the profile.',
          );
        }
      } else if (entry.isDirectory()) {
        walk(full);
      }
    }
  };
  walk(rootDir);
}

function copyFromHost(targetProfileDir: string, configMounts: ConfigMount[]): void {
  let copied = 0;
  for (const mount of configMounts) {
    const hostDir = hostDirForMount(mount);
    if (!existsSync(hostDir)) continue;

    warnOnEscapingSymlinks(hostDir);
    const targetDir = join(targetProfileDir, mount.source);
    rmSync(targetDir, { recursive: true, force: true });
    copyDirWithResolvedSymlinks(hostDir, targetDir);

    for (const ex of mount.exfiltrateExcludes || []) {
      rmSync(join(targetDir, ex), { recursive: true, force: true });
    }

    console.log(`Copied ${hostDir} into the profile.`);
    copied++;
  }
  if (copied === 0) {
    const tried = configMounts.map((m) => hostDirForMount(m)).join(', ');
    throw new Error(
      `None of the host config directories exist (${tried}). Cannot copy configuration from host.`,
    );
  }
}

function symlinkFromHost(targetProfileDir: string, configMounts: ConfigMount[]): void {
  let linked = 0;
  for (const mount of configMounts) {
    const hostDir = hostDirForMount(mount);
    if (!existsSync(hostDir)) continue;

    warnOnEscapingSymlinks(hostDir);
    const targetDir = join(targetProfileDir, mount.source);
    rmSync(targetDir, { recursive: true, force: true });
    mkdirSync(dirname(targetDir), { recursive: true });
    symlinkSync(hostDir, targetDir);

    console.log(`Symlinked ${hostDir} into the profile.`);
    linked++;
  }
  if (linked === 0) {
    const tried = configMounts.map((m) => hostDirForMount(m)).join(', ');
    throw new Error(
      `None of the host config directories exist (${tried}). Cannot symlink configuration from host.`,
    );
  }
}

function sourceDirForOptions(options: InitOptions): string {
  const selectedSources = [
    options.selfTest,
    Boolean(options.template),
    Boolean(options.fromProfile),
  ].filter(Boolean).length;

  if (selectedSources > 1) {
    throw new Error('Use only one of --self-test, --template, or --from-profile.');
  }

  if (options.selfTest) {
    return join(TEMPLATE_PROFILES_DIR, 'self-test');
  }

  if (options.template) {
    if (!SHIPPED_TEMPLATES.has(options.template)) {
      throw new Error(
        `Unknown profile template "${options.template}". Available: ${[...SHIPPED_TEMPLATES].join(', ')}`,
      );
    }
    return join(TEMPLATE_PROFILES_DIR, options.template);
  }

  if (options.fromProfile) {
    return join(getProfilesDir(), options.fromProfile);
  }

  return join(TEMPLATE_PROFILES_DIR, DEFAULT_TEMPLATE);
}

async function init(profileName: string | undefined, options: InitOptions = {}): Promise<void> {
  try {
    if (!profileName) {
      throw new Error('Profile name is required. Usage: psbx profile init <profile>');
    }

    if (options.copyFromHost && options.symlinkFromHost) {
      throw new Error('Use only one of --copy-from-host or --symlink-from-host.');
    }

    ensureConfig();
    const profilesDir = getProfilesDir();
    const targetDir = join(profilesDir, profileName);

    if (existsSync(targetDir)) {
      throw new Error(`Profile already exists at ${targetDir}`);
    }

    const sourceDir = sourceDirForOptions(options);
    if (!existsSync(sourceDir)) {
      throw new Error(`Source profile template not found at ${sourceDir}`);
    }

    mkdirSync(profilesDir, { recursive: true });

    // Use a staging directory for atomic creation — if anything fails mid-way,
    // no half-finished profile is left behind.
    const stagingDir = join(profilesDir, `.${profileName}.tmp`);
    rmSync(stagingDir, { recursive: true, force: true });

    try {
      copyProfileTemplate(sourceDir, stagingDir);

      if (options.copyFromHost) {
        const { configMounts } = loadEnv(stagingDir);
        copyFromHost(stagingDir, configMounts);
      } else if (options.symlinkFromHost) {
        const { configMounts } = loadEnv(stagingDir);
        symlinkFromHost(stagingDir, configMounts);
      } else {
        const { configMounts } = loadEnv(stagingDir);
        const existingHostDirs = configMounts
          .map((m) => ({ mount: m, hostDir: hostDirForMount(m) }))
          .filter(({ mount, hostDir }) => {
            if (!existsSync(hostDir)) return false;
            const profileDir = join(stagingDir, mount.source);
            return !existsSync(profileDir) || readdirSync(profileDir).length === 0;
          });
        if (existingHostDirs.length > 0) {
          const dirs = existingHostDirs.map(({ hostDir }) => hostDir).join(', ');
          console.log(
            `Tip: re-run with \`--copy-from-host\` or \`--symlink-from-host\` to use your existing host configuration from ${dirs}.`,
          );
        }
      }

      generateSchema(stagingDir);
      addSchemaHeader(join(stagingDir, 'lima.yaml'));

      // Atomically move staging dir to final location
      renameSync(stagingDir, targetDir);
    } catch (err: unknown) {
      rmSync(stagingDir, { recursive: true, force: true });
      throw err;
    }

    // Auto-set as default if no default profile is configured yet, or if explicitly requested
    const freshConfig: AppConfig = loadConfig();
    if (options.setAsDefault || !freshConfig.defaultProfile) {
      setDefaultProfile(profileName);
      console.log(`Set "${profileName}" as the default profile.`);
    }

    console.log(`Created profile "${profileName}" at ${targetDir}`);
    console.log('Edit lima.yaml, env.yaml, and the profile config dirs as needed.');
  } catch (err: unknown) {
    handleError(err);
  }
}

export { init };
