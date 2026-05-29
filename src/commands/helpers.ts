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
import {
  FinalizerStatus,
  type LimaConfig,
  LimaStatus,
  type Profile,
  type ProfileHashes,
  type RegistryEntry,
  type ResolveContextResult,
} from '../types.ts';
import { errorMessage, hasErrorCode, workspaceMkdirTarget } from '../utils.ts';

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

interface CacheRef {
  cacheName: string;
  cacheKey: string;
}

interface FinalizeAndRegisterOptions {
  vmName: string;
  profile: Profile;
  projectDir: string;
  cacheRef?: CacheRef;
}

// Process-global by design: the `-y/--yes` flag is parsed once on the root
// command (see bin/psbx.ts preAction hook) and applies to every confirm()
// for the lifetime of the process.
let _globalYes = false;

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
    // Sticky profile: if the user didn't explicitly specify --profile and
    // a VM already exists for this workdir in the registry, use the
    // profile recorded there instead of defaultProfile. This ensures
    // `psbx up` always picks the profile the VM was created with.
    const profileOverride = options.profile || (context.registryEntry?.profile ?? undefined);
    context.profile = resolveProfile(config, profileOverride);
  }

  return context;
}

interface ResolveProfileForVmOptions {
  profileOverride?: string;
}

/**
 * Resolve the profile bound to a VM for read-only/runtime use. Uses the
 * explicit override if given, else the profile recorded in the registry,
 * else the global default. Instead of throwing when the profile was deleted
 * or renamed, returns `{ profile: null, warning }` so callers can degrade
 * gracefully (e.g. exec still opens a shell; logs still reports the project VM).
 */
function resolveProfileForVm(
  vmName: string,
  { profileOverride }: ResolveProfileForVmOptions = {},
): { profile: Profile | null; warning?: string } {
  const config = loadConfig();
  const entry = getRegistryEntry(vmName);
  const name = profileOverride || entry?.profile || undefined;
  try {
    return { profile: resolveProfile(config, name) };
  } catch (err: unknown) {
    return { profile: null, warning: errorMessage(err) };
  }
}

async function confirm(question: string): Promise<boolean> {
  if (_globalYes) return true;
  // Without an interactive terminal there is no one to answer the prompt.
  // Rather than hang on a closed stdin or read an ambiguous EOF, print the
  // question for context and abort, pointing the user at -y/--yes.
  if (!input.isTTY) {
    process.stdout.write(question);
    console.log('');
    throw new Error(
      'Cannot prompt for confirmation without an interactive terminal. ' +
        'Re-run with -y/--yes to proceed non-interactively.',
    );
  }
  const rl = readline.createInterface({ input, output });
  try {
    const answer = await rl.question(question);
    const normalized = answer.trim().toLowerCase();
    return normalized === 'y' || normalized === 'yes';
  } finally {
    rl.close();
  }
}

/**
 * Resolve a path to its canonical form, falling back to the original path
 * when it cannot be resolved (e.g. it does not exist on disk).
 */
function safeRealpath(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

/**
 * Guard against cross-project VM collisions. The VM name is derived from the
 * project directory's basename, so two unrelated projects sharing a basename
 * (e.g. `~/work/app` and `~/clients/app`) map to the same VM. Commands that
 * operate on the current project's VM must confirm that the registered
 * `projectDir` matches the directory psbx was invoked from before touching the
 * VM, otherwise a command could silently attach to another project's sandbox.
 *
 * On mismatch the user is prompted (this normally means the project directory
 * was moved on the host). Confirming updates the registered `projectDir`;
 * declining aborts to preserve project isolation.
 */
async function assertProjectDirMatches(
  vmName: string,
  cwd: string,
  registryEntry: RegistryEntry | null,
): Promise<void> {
  if (!registryEntry) return;
  if (safeRealpath(cwd) === safeRealpath(registryEntry.projectDir)) return;

  console.warn(
    `Warning: The current directory does not match the project directory recorded for sandbox '${vmName}'.`,
  );
  console.warn(`  Registry: ${registryEntry.projectDir}`);
  console.warn(`  Current:  ${cwd}`);
  console.warn('This usually means the project directory was moved on the host, or that an');
  console.warn('unrelated directory shares the same name and maps to the same sandbox.');

  const update = await confirm(
    'Update the registered project directory to the current directory? [y/N] ',
  );
  if (!update) {
    throw new Error(
      `Sandbox '${vmName}' is bound to a different project directory. ` +
        'Aborting to preserve project isolation.',
    );
  }
  registerVm(vmName, { ...registryEntry, projectDir: cwd });
  console.log(`Registry entry for '${vmName}' updated to: ${cwd}`);
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
  if (limaStatus(vmName) === LimaStatus.Running) {
    console.log(`Stopping sandbox '${vmName}'...`);
    limaStop(vmName, { force });
  }
}

/**
 * Hash of the fully-rendered Lima config for this profile + project. Feeds the
 * registry's `limaConfigHash`. A mismatch means the rendered lima.yaml (profile
 * lima.yaml, provisioning file contents, CA certs, or project `.psbx/lima.yaml`
 * overrides) changed since the VM was created, which `up` treats as a
 * recreate-worthy mismatch (the VM must be rebuilt).
 */
function hashLimaConfig(profile: Profile, projectDir: string): string {
  const config: LimaConfig = buildLimaConfig(profile, projectDir);
  return hashRenderedLimaConfig(config);
}

/**
 * Core hash over a rendered Lima config plus its referenced provisioning files
 * and CA certs. Shared by `hashLimaConfig` (registry `limaConfigHash`) and by
 * the cache layer's content-addressed cache key (`extraInputs` carries the
 * cache-safe inputs). Pure function of its inputs.
 */
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
 * sessions[].workspacePath / sessions[].guestSymlink / guestTarget were
 * edited. Add / remove / rename of mounts also flips this hash, but those
 * changes additionally flip `limaConfigHash`, which routes the operation
 * through a full recreate.
 */
function hashFinalizerConfig(
  profile: Pick<Profile, 'configMounts' | 'sessions' | 'shadowPaths' | 'dir'>,
): string {
  const hash = createHash('sha256');
  const canonical = JSON.stringify({
    configMounts: (profile.configMounts || []).map((m) => ({
      source: m.source,
      name: m.name,
      guestTarget: m.guestTarget,
    })),
    sessions: (profile.sessions || []).map((s) => ({
      workspacePath: s.workspacePath,
      guestSymlink: s.guestSymlink ?? null,
    })),
    shadowPaths: profile.shadowPaths || [],
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
  for (const session of profile.sessions || []) {
    // Trailing-slash convention: see SessionMount.workspacePath in types.ts.
    mkdirSync(join(projectDir, workspaceMkdirTarget(session.workspacePath)), {
      recursive: true,
    });
  }
}

/** Print the canonical two-line "sandbox is ready" banner. */
function printSandboxReady(vmName: string): void {
  console.log('');
  console.log(`Sandbox '${vmName}' is ready!`);
  console.log('Run `psbx exec` to run a command, or `psbx up` to enter the default shell.');
}

/**
 * Shared tail of every create/recreate path: register the VM as `pending`
 * (so cleanup works if finalization fails), wait for provisioning, run the
 * finalizer, re-register as `done`, and print the ready banner. `cacheRef`
 * is supplied when the VM was cloned from a profile cache.
 */
function finalizeAndRegister({
  vmName,
  profile,
  projectDir,
  cacheRef,
}: FinalizeAndRegisterOptions): void {
  const hashes = profileHashes(profile, projectDir);
  const cacheFields = cacheRef
    ? { profileCacheName: cacheRef.cacheName, profileCacheKey: cacheRef.cacheKey }
    : {};

  registerVm(vmName, {
    projectDir,
    profile: profile.name,
    finalizerStatus: FinalizerStatus.Pending,
    ...cacheFields,
    ...hashes,
  });

  limaCheckProvisioning(vmName);
  finalizeVm(vmName, profile);

  registerVm(vmName, {
    projectDir,
    profile: profile.name,
    finalizerStatus: FinalizerStatus.Done,
    ...cacheFields,
    ...hashes,
  });

  printSandboxReady(vmName);
}

/**
 * Shared "bypass-the-cache" provisioning pipeline used by `up` when extra
 * limactl arguments are supplied (which make caching unsafe). Creates a
 * temp lima.yaml, starts the VM, then runs the shared finalize/register tail.
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

  finalizeAndRegister({ vmName, profile, projectDir });
}

export {
  assertProjectDirMatches,
  assertVmExists,
  confirm,
  finalizeAndRegister,
  handleError,
  hashDefaultCmd,
  hashFinalizerConfig,
  hashLimaConfig,
  hashRenderedLimaConfig,
  hashShellEnvAllowlist,
  prepareProjectState,
  printSandboxReady,
  profileHashes,
  provisionVm,
  resolveContext,
  resolveProfileForVm,
  safeRealpath,
  setGlobalYes,
  stopIfRunning,
};
