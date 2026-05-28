/**
 * Cross-command helpers used by the CLI entry points in `src/commands/`.
 *
 * Groups three concerns:
 *
 *   1. **Context resolution** — `resolveContext` loads config, derives the
 *      current project's VM name, and (optionally) resolves the profile in
 *      one call so individual commands don't repeat the boilerplate.
 *
 *   2. **User interaction** — `confirm` (honors the `-y/--yes` global flag),
 *      `assertVmExists`, `stopIfRunning`, and `handleError` (the canonical
 *      top-level catch site that exits 1 with a tidy message).
 *
 *   3. **Profile drift hashing + provisioning** — the four hash functions
 *      stored in the registry (`limaConfig`, `finalizer`, `shellEnvAllowlist`,
 *      `defaultCmd`) and `provisionVm`, the shared create/finalize/register
 *      pipeline used when bypassing the profile cache.
 */

import { createHash, type Hash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  type Stats,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stdin as input, stdout as output } from 'node:process';
import * as readline from 'node:readline/promises';
import { expandHome, getVmName, loadConfig, resolveProfile } from '../config.ts';
import { finalizeVm } from '../finalize.ts';
import { limaCheckProvisioning, limaStart, limaStatus, limaStop } from '../lima.ts';
import { getRegistryEntry, registerVm } from '../registry.ts';
import {
  buildLimaConfig,
  provisionFilePaths,
  stringifyLimaConfig,
  writeLimaYaml,
} from '../template.ts';
import type { LimaConfig, Profile, ProfileHashes, ResolveContextResult } from '../types.ts';

interface ResolveContextOptions {
  profile?: string;
}

interface ResolveContextSettings {
  withProfile?: boolean;
}

interface AssertVmExistsOptions {
  extraHint?: string;
}

interface StopIfRunningOptions {
  force?: boolean;
}

interface HashProfilePathOptions {
  followSymlink?: boolean;
  excludes?: Set<string>;
}

interface ProvisionVmOptions {
  vmName: string;
  profile: Profile;
  projectDir: string;
  limactlArgs?: string[];
  label?: string;
}

let _globalYes = false;

function hasErrorCode(err: unknown, code: string): err is Error & { code: string } {
  return err instanceof Error && 'code' in err && err.code === code;
}

function setGlobalYes(val: boolean | undefined): void {
  _globalYes = !!val;
}

function resolveContext(
  options: ResolveContextOptions,
  settings: { withProfile: true },
): ResolveContextResult & { profile: Profile };
function resolveContext(
  options?: ResolveContextOptions,
  settings?: { withProfile?: false },
): ResolveContextResult;
function resolveContext(
  options: ResolveContextOptions = {},
  { withProfile = false }: ResolveContextSettings = {},
): ResolveContextResult & { profile?: Profile } {
  const config: ResolveContextResult['config'] = loadConfig();
  const vmName = getVmName();
  const projectDir = process.cwd();
  const context: ResolveContextResult & { profile?: Profile } = {
    config,
    vmName,
    projectDir,
    registryEntry: getRegistryEntry(vmName),
  };

  if (withProfile) {
    context.profile = resolveProfile(config, options.profile);
  }

  return context;
}

async function confirm(question: string): Promise<boolean> {
  if (_globalYes) return true;
  const rl = readline.createInterface({ input, output });
  try {
    const answer = await rl.question(question);
    const normalized = answer.trim().toLowerCase();
    return normalized === 'y' || normalized === 'yes';
  } finally {
    rl.close();
  }
}

function handleError(err: unknown): never {
  if (err instanceof Error) {
    console.error(`Error: ${err.message}`);
  } else {
    console.error('An unexpected error occurred.');
  }
  process.exit(1);
}

/**
 * Asserts that a VM exists. Prints an error and exits(1) if not. Returns
 * the current Lima status string when the VM exists.
 */
function assertVmExists(vmName: string, { extraHint }: AssertVmExistsOptions = {}): string {
  const status = limaStatus(vmName);
  if (status === null) {
    console.error(`Error: Sandbox '${vmName}' does not exist.`);
    if (extraHint) console.error(extraHint);
    process.exit(1);
  }
  return status;
}

/**
 * Stops the VM if it is currently running. Prints a "Stopping..." line so
 * callers don't have to.
 */
function stopIfRunning(vmName: string, { force = false }: StopIfRunningOptions = {}): void {
  if (limaStatus(vmName) === 'Running') {
    console.log(`Stopping sandbox '${vmName}'...`);
    limaStop(vmName, { force });
  }
}

function hashLimaConfig(profile: Profile, projectDir: string): string {
  const config: LimaConfig = buildLimaConfig(profile, projectDir);
  return hashRenderedLimaConfig(config);
}

function hashRenderedLimaConfig(
  config: LimaConfig,
  extraInputs: Record<string, unknown> = {},
): string {
  const hash = createHash('sha256');
  hash.update(stringifyLimaConfig(config));
  hash.update('\0');
  hash.update(JSON.stringify(extraInputs));

  for (const file of provisionFilePaths(config).sort()) {
    hash.update('\0provision-file\0');
    hash.update(file);
    hash.update('\0');
    hash.update(readFileSync(file));
  }

  for (const file of caCertFilePaths(config).sort()) {
    const expanded = expandHome(file);
    hash.update('\0ca-cert-file\0');
    hash.update(file);
    hash.update('\0');
    if (existsSync(expanded)) {
      hash.update(readFileSync(expanded));
    } else {
      hash.update('<missing>');
    }
  }

  return hash.digest('hex');
}

function caCertFilePaths(config: LimaConfig): string[] {
  const files = config.caCerts?.files;
  if (!Array.isArray(files)) {
    return [];
  }
  return files.filter((file): file is string => typeof file === 'string' && Boolean(file));
}

/**
 * Hash of the shellEnvAllowlist. Pure runtime value — read live by `exec`
 * and `up` at shell-launch time; never requires recreate or finalize.
 */
function hashShellEnvAllowlist(profile: Profile): string {
  const canonical = JSON.stringify([...(profile.shellEnvAllowlist || [])].sort());
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Hash of the defaultCmd. Pure runtime value — read live by `up` at
 * shell-launch time; never requires recreate or finalize.
 */
function hashDefaultCmd(profile: Profile): string {
  const canonical = JSON.stringify(profile.defaultCmd ?? null);
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Hash of the profile inputs the finalizer consumes. A mismatch means
 * either the contents of a configMount's source dir changed, or
 * projectSessionDir / sessionSymlink / guestTarget were edited. Add / remove / rename of
 * mounts also flips this hash, but those changes additionally flip
 * `limaConfigHash`, which routes the operation through a full recreate.
 */
function hashFinalizerConfig(profile: Profile): string {
  const hash = createHash('sha256');
  const canonical = JSON.stringify({
    configMounts: (profile.configMounts || []).map((m) => ({
      source: m.source,
      name: m.name,
      guestTarget: m.guestTarget,
      projectSessionDir: m.projectSessionDir ?? null,
      sessionSymlink: m.sessionSymlink ?? null,
    })),
  });
  hash.update(canonical);

  if (profile.dir) {
    for (const mount of profile.configMounts || []) {
      hash.update('\0config-mount\0');
      hash.update(mount.name);
      hash.update('\0');
      const excludes = new Set(
        (mount.driftDetectionExcludes || []).map((e) => `${mount.source}/${e}`),
      );
      hashProfilePath(hash, join(profile.dir, mount.source), mount.source, new Set(), {
        excludes,
      });
    }
  }

  return hash.digest('hex');
}

/**
 * Compute the full set of profile-derived hashes the registry stores per VM.
 */
function profileHashes(profile: Profile, projectDir: string): ProfileHashes {
  return {
    limaConfigHash: hashLimaConfig(profile, projectDir),
    finalizerHash: hashFinalizerConfig(profile),
    shellEnvAllowlistHash: hashShellEnvAllowlist(profile),
    defaultCmdHash: hashDefaultCmd(profile),
  };
}

function statMode(stat: Stats): string {
  return (stat.mode & 0o7777).toString(8);
}

function hashProfilePath(
  hash: Hash,
  path: string,
  relativePath: string,
  seen: Set<string>,
  { followSymlink = true, excludes }: HashProfilePathOptions = {},
): void {
  if (excludes?.has(relativePath)) {
    hash.update(`${relativePath}\0excluded`);
    return;
  }

  let lst: Stats;
  try {
    lst = lstatSync(path);
  } catch (err: unknown) {
    if (!hasErrorCode(err, 'ENOENT')) throw err;
    hash.update(`${relativePath}\0missing`);
    return;
  }

  if (lst.isSymbolicLink() && !followSymlink) {
    hash.update(`${relativePath}\0symlink\0${statMode(lst)}\0${readlinkSync(path)}`);
    return;
  }

  const realPath = realpathSync(path);
  if (seen.has(realPath)) {
    hash.update(`${relativePath}\0seen`);
    return;
  }

  const stat = lst.isSymbolicLink() ? statSync(path) : lst;
  if (stat.isDirectory()) {
    seen.add(realPath);
    hash.update(`${relativePath}\0dir\0${statMode(stat)}`);
    for (const name of readdirSync(path).sort()) {
      hashProfilePath(hash, join(path, name), `${relativePath}/${name}`, seen, {
        followSymlink: false,
        excludes,
      });
    }
    seen.delete(realPath);
    return;
  }

  if (stat.isFile()) {
    hash.update(`${relativePath}\0file\0${statMode(stat)}\0`);
    hash.update(readFileSync(path));
    return;
  }

  hash.update(`${relativePath}\0other\0${statMode(stat)}`);
}

/**
 * Refuse to materialize project state under `.agents/` when the
 * directory exists but is a symlink or non-directory. Catches the case
 * where a user has redirected `.agents` somewhere unexpected.
 */
function assertSafeAgentDir(projectDir: string): void {
  const agentDir = join(projectDir, '.agents');
  let st: Stats;
  try {
    st = lstatSync(agentDir);
  } catch (err: unknown) {
    if (!hasErrorCode(err, 'ENOENT')) throw err;
    return; // does not exist yet — mkdirSync will create it safely
  }
  if (st.isSymbolicLink()) {
    throw new Error(
      `.agents in the project directory is a symlink; refusing to create state inside it`,
    );
  }
  if (!st.isDirectory()) {
    throw new Error(`.agents in the project directory exists but is not a directory`);
  }
}

function prepareProjectState(profile: Profile, projectDir: string): void {
  assertSafeAgentDir(projectDir);
  for (const mount of profile.configMounts) {
    if (mount.projectSessionDir) {
      mkdirSync(join(projectDir, mount.projectSessionDir), { recursive: true });
    }
  }
}

/**
 * Shared "bypass-the-cache" provisioning pipeline used by `up` when extra
 * limactl arguments are supplied (which make caching unsafe). Creates a
 * temp lima.yaml, starts the VM, registers early (so cleanup works on
 * failure), then runs the finalizer and re-registers as `done`.
 */
function provisionVm({
  vmName,
  profile,
  projectDir,
  limactlArgs = [],
  label = 'Creating',
}: ProvisionVmOptions): void {
  prepareProjectState(profile, projectDir);

  const tmpDir = mkdtempSync(join(tmpdir(), 'psbx-'));
  const tmpPath = join(tmpDir, 'lima.yaml');
  writeLimaYaml(profile, projectDir, tmpPath);

  console.log(`${label} sandbox: ${vmName}`);
  console.log(`  Profile: ${profile.name}`);
  console.log(`  Project: ${projectDir}`);
  console.log('');

  try {
    limaStart(vmName, tmpPath, limactlArgs);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }

  // Register early so delete/cleanup works even if provisioning fails.
  const hashes = profileHashes(profile, projectDir);
  registerVm(vmName, {
    projectDir,
    profile: profile.name,
    finalizerStatus: 'pending',
    ...hashes,
  });

  limaCheckProvisioning(vmName);
  finalizeVm(vmName, profile);
  registerVm(vmName, {
    projectDir,
    profile: profile.name,
    finalizerStatus: 'done',
    ...hashes,
  });

  console.log('');
  console.log(`Sandbox '${vmName}' is ready!`);
  console.log('Run `psbx exec` to run a command, or `psbx up` to enter the default shell.');
}

export {
  assertVmExists,
  confirm,
  handleError,
  hashDefaultCmd,
  hashFinalizerConfig,
  hashLimaConfig,
  hashRenderedLimaConfig,
  hashShellEnvAllowlist,
  prepareProjectState,
  profileHashes,
  provisionVm,
  resolveContext,
  setGlobalYes,
  stopIfRunning,
};
