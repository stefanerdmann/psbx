/**
 * Shared TypeScript interfaces for psbx configuration, registry
 * entries, profile metadata, and Lima primitives.
 *
 * This module is almost entirely type-only. The sole runtime exports are the
 * small status-constant objects at the bottom (`FinalizerStatus`,
 * `CacheStatus`, `LimaStatus`), kept here so the persisted/observed status
 * strings have a single authoritative definition shared by all consumers.
 */

/**
 * Declares where persistent runtime session data lives in the project
 * workspace (`workspacePath`), and optionally redirects a path inside the
 * guest to that location via a symlink (`guestSymlink`).
 */
export interface SessionMount {
  /**
   * Workspace-relative path for persistent session data; survives VM rebuilds.
   *
   * Trailing-slash convention:
   *   - Ends with `/`  → treated as a **directory**: the directory itself is
   *                      created with `mkdir -p` on both host and guest.
   *   - No trailing `/` → treated as a **file path**: only the parent directory
   *                      is created; the file itself is the agent tool's
   *                      responsibility (it does not exist on VM creation).
   */
  workspacePath: string;
  guestSymlink?: string;
}

export interface ConfigMount {
  source: string;
  name: string;
  guestTarget: string;
  exfiltrateExcludes?: string[];
  driftDetectionExcludes?: string[];
}

export interface EnvConfig {
  defaultCmd?: string;
  shellEnvAllowlist: string[];
  configMounts: ConfigMount[];
  sessions: SessionMount[];
  shadowPaths: string[];
}

export interface Profile extends EnvConfig {
  name: string;
  dir: string;
  limaPath: string;
}

export interface AppConfig {
  defaultProfile: string | null;
}

export interface RegistryEntry {
  projectDir: string;
  profile: string | null;
  finalizerStatus?: string;
  limaConfigHash?: string;
  finalizerHash?: string;
  shellEnvAllowlistHash?: string;
  defaultCmdHash?: string;
  profileCacheName?: string;
  profileCacheKey?: string;
}

export interface CacheEntry {
  profile: string;
  cacheKey: string;
  limaVersion: string | null;
  createdAt: string | null;
  sysprepVersion?: number;
  status?: string;
  failedAt?: string;
  failureReason?: string;
}

export interface ProfileCacheInputs {
  cacheKey: string;
  cacheName: string;
  limaVersion: string;
  sysprepVersion: number;
  yaml: string;
}

export interface ProfileHashes {
  limaConfigHash: string;
  finalizerHash: string;
  shellEnvAllowlistHash: string;
  defaultCmdHash: string;
}

export interface ValidationResult {
  errors: string[];
  warnings: string[];
  info: string[];
}

export interface LimaMount {
  location?: string;
  mountPoint: string;
  writable?: boolean;
}

export interface LimaProvision {
  mode?: string;
  script?: string;
  file?: string;
}

export interface LimaConfig {
  cpus?: number;
  memory?: string;
  disk?: string;
  mounts?: LimaMount[];
  provision?: LimaProvision[];
  caCerts?: { files?: string[] };
  user?: { name?: string; home?: string };
  [key: string]: unknown;
}

export interface LimaInstance {
  name: string;
  status?: string;
  config?: {
    cpus?: number;
    memory?: string | number;
    disk?: string | number;
  };
  sshLocalPort?: number;
  [key: string]: unknown;
}

export interface ConfigFileData {
  defaultProfile?: string;
  vms?: Record<string, RegistryEntry>;
  caches?: Record<string, CacheEntry>;
  [key: string]: unknown;
}

export interface ResolveContextResult {
  config: AppConfig;
  vmName: string;
  projectDir: string;
  registryEntry: RegistryEntry | null;
  profile?: Profile;
}

export interface SyncDriftItem {
  field: string;
  message: string;
  guidance: string;
}

/**
 * Per-VM finalizer progress stored in the registry. `Pending` means clone
 * succeeded but the in-guest finalizer has not completed; `Done` means it has.
 */
export const FinalizerStatus = {
  Pending: 'pending',
  Done: 'done',
} as const;
export type FinalizerStatusValue = (typeof FinalizerStatus)[keyof typeof FinalizerStatus];

/** Profile-cache build outcome stored in the cache registry. */
export const CacheStatus = {
  Ready: 'ready',
  Failed: 'failed',
} as const;
export type CacheStatusValue = (typeof CacheStatus)[keyof typeof CacheStatus];

/** Lima instance status strings psbx branches on. */
export const LimaStatus = {
  Running: 'Running',
} as const;
export type LimaStatusValue = (typeof LimaStatus)[keyof typeof LimaStatus];
