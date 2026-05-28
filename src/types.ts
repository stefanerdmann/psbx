/**
 * Shared TypeScript interfaces for psbx configuration, registry
 * entries, profile metadata, and Lima primitives.
 *
 * This module is type-only: no runtime code lives here. The split keeps
 * cross-module imports cheap and lets the structural shape of persisted
 * data (profiles, registry, caches) be reviewed in one place.
 */

export interface ConfigMount {
  source: string;
  name: string;
  guestTarget: string;
  sessions?: {
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
  };
  exfiltrateExcludes?: string[];
  driftDetectionExcludes?: string[];
}

export interface EnvConfig {
  defaultCmd?: string;
  shellEnvAllowlist: string[];
  configMounts: ConfigMount[];
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
