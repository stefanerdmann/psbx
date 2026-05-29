/**
 * Persistent on-disk registries stored in `~/.psbx/config.json`.
 *
 * Two parallel maps live here:
 *   - `vms`     — per-project VM bindings (project dir, profile, drift
 *                 hashes, finalizer status, cache pointer).
 *   - `caches`  — per-profile clone-source VMs that `up` clones from.
 *
 * The module re-reads `config.json` on every mutation so concurrent CLI
 * invocations do not stomp each other for unrelated keys.  All entries are
 * normalized on load — anything that fails validation is silently dropped
 * rather than raising, because the CLI must remain usable even when the
 * registry file has been hand-edited or partially corrupted.
 */

import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { getConfigPath } from './config.ts';
import type { CacheEntry, ConfigFileData, RegistryEntry } from './types.ts';
import { errorMessage, hasErrorCode, isPlainObject } from './utils.ts';

type RegistryMap = Record<string, RegistryEntry | null>;
type CacheRegistryMap = Record<string, CacheEntry | null>;
type RegistryOptionalField = Exclude<keyof RegistryEntry, 'projectDir' | 'profile'>;

const OPTIONAL_REGISTRY_FIELDS: readonly RegistryOptionalField[] = [
  'finalizerStatus',
  'limaConfigHash',
  'finalizerHash',
  'shellEnvAllowlistHash',
  'defaultCmdHash',
  'profileCacheName',
  'profileCacheKey',
];

function normalizeEntry(entry: unknown): RegistryEntry | null {
  if (!isPlainObject(entry)) {
    return null;
  }

  const projectDir = entry.projectDir;
  if (typeof projectDir !== 'string' || !projectDir) {
    return null;
  }

  const normalized: RegistryEntry = {
    projectDir,
    profile: typeof entry.profile === 'string' && entry.profile ? entry.profile : null,
  };
  for (const field of OPTIONAL_REGISTRY_FIELDS) {
    const value = entry[field];
    if (typeof value === 'string' && value) {
      normalized[field] = value;
    }
  }
  return normalized;
}

function normalizeCacheEntry(entry: unknown): CacheEntry | null {
  if (!isPlainObject(entry)) {
    return null;
  }
  if (typeof entry.profile !== 'string' || !entry.profile) {
    return null;
  }
  if (typeof entry.cacheKey !== 'string' || !entry.cacheKey) {
    return null;
  }
  return {
    profile: entry.profile,
    cacheKey: entry.cacheKey,
    limaVersion: typeof entry.limaVersion === 'string' ? entry.limaVersion : null,
    createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : null,
  };
}

function readConfigFile(): ConfigFileData {
  try {
    const raw = readFileSync(getConfigPath(), 'utf-8');
    const data = JSON.parse(raw) as unknown;
    if (!isPlainObject(data)) {
      return {};
    }
    return data as ConfigFileData;
  } catch {
    return {};
  }
}

function writeConfigFile(data: ConfigFileData): void {
  const configPath = getConfigPath();
  mkdirSync(dirname(configPath), { recursive: true });
  // Write to a temp file then atomically rename so a crash or a concurrent
  // reader never observes a half-written config.json.
  const tmpPath = `${configPath}.tmp.${process.pid}.${Math.random().toString(36).slice(2)}`;
  writeFileSync(tmpPath, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
  try {
    renameSync(tmpPath, configPath);
  } catch (err: unknown) {
    rmSync(tmpPath, { force: true });
    throw err;
  }
}

const LOCK_RETRY_MS = 20;
const LOCK_TIMEOUT_MS = 5_000;
const LOCK_STALE_MS = 30_000;

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Run `fn` while holding an exclusive lockfile next to config.json so a full
 * read-modify-write cycle is atomic across concurrent psbx invocations (which
 * would otherwise lose writes: read A, read B, write A, write B). Stale locks
 * older than LOCK_STALE_MS are reclaimed.
 */
function withConfigLock<T>(fn: () => T): T {
  const lockPath = `${getConfigPath()}.lock`;
  mkdirSync(dirname(lockPath), { recursive: true });
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  let fd: number | undefined;
  while (fd === undefined) {
    try {
      fd = openSync(lockPath, 'wx');
    } catch (err: unknown) {
      if (!hasErrorCode(err, 'EEXIST')) throw err;
      try {
        if (Date.now() - statSync(lockPath).mtimeMs > LOCK_STALE_MS) {
          rmSync(lockPath, { force: true });
          continue;
        }
      } catch {
        // lock vanished between open and stat — retry immediately
        continue;
      }
      if (Date.now() > deadline) {
        throw new Error(`Timed out acquiring registry lock at ${lockPath}`);
      }
      sleepSync(LOCK_RETRY_MS);
    }
  }
  try {
    return fn();
  } finally {
    closeSync(fd);
    rmSync(lockPath, { force: true });
  }
}

/** Atomically read config.json, apply `mutator`, and write it back. */
function mutateConfig(mutator: (data: ConfigFileData) => void): void {
  withConfigLock(() => {
    const data = readConfigFile();
    mutator(data);
    writeConfigFile(data);
  });
}

function setMapField<T>(
  data: ConfigFileData,
  field: 'vms' | 'caches',
  map: Record<string, T | null>,
): void {
  if (Object.keys(map).length > 0) {
    (data as Record<string, unknown>)[field] = map;
  } else {
    delete (data as Record<string, unknown>)[field];
  }
}

function normalizeVms(raw: unknown): Record<string, RegistryEntry> {
  const normalized: Record<string, RegistryEntry> = {};
  if (isPlainObject(raw)) {
    for (const [vmName, entry] of Object.entries(raw)) {
      const normalizedEntry = normalizeEntry(entry);
      if (normalizedEntry?.projectDir) {
        normalized[vmName] = normalizedEntry;
      }
    }
  }
  return normalized;
}

function normalizeCaches(raw: unknown): Record<string, CacheEntry> {
  const normalized: Record<string, CacheEntry> = {};
  if (isPlainObject(raw)) {
    for (const [cacheName, entry] of Object.entries(raw)) {
      const normalizedEntry = normalizeCacheEntry(entry);
      if (normalizedEntry) {
        normalized[cacheName] = normalizedEntry;
      }
    }
  }
  return normalized;
}

function loadRegistry(): Record<string, RegistryEntry> {
  return normalizeVms(readConfigFile().vms);
}

function loadCacheRegistry(): Record<string, CacheEntry> {
  return normalizeCaches(readConfigFile().caches);
}

function saveRegistry(registry: RegistryMap): void {
  try {
    mutateConfig((data) => {
      setMapField(data, 'vms', registry);
    });
  } catch (err: unknown) {
    console.warn(`Warning: Could not save VM registry: ${errorMessage(err)}`);
  }
}

function saveCacheRegistry(caches: CacheRegistryMap): void {
  try {
    mutateConfig((data) => {
      setMapField(data, 'caches', caches);
    });
  } catch (err: unknown) {
    console.warn(`Warning: Could not save cache registry: ${errorMessage(err)}`);
  }
}

function registerVm(vmName: string, entry: unknown): void {
  mutateConfig((data) => {
    const registry: RegistryMap = normalizeVms(data.vms);
    registry[vmName] = normalizeEntry(entry);
    setMapField(data, 'vms', registry);
  });
}

function unregisterVm(vmName: string): void {
  mutateConfig((data) => {
    const registry: RegistryMap = normalizeVms(data.vms);
    delete registry[vmName];
    setMapField(data, 'vms', registry);
  });
}

function getRegistry(): Record<string, RegistryEntry> {
  return loadRegistry();
}

function getRegistryEntry(vmName: string): RegistryEntry | null {
  return loadRegistry()[vmName] || null;
}

function registerCache(cacheName: string, entry: unknown): void {
  mutateConfig((data) => {
    const caches: CacheRegistryMap = normalizeCaches(data.caches);
    caches[cacheName] = normalizeCacheEntry(entry);
    setMapField(data, 'caches', caches);
  });
}

function unregisterCache(cacheName: string): void {
  mutateConfig((data) => {
    const caches: CacheRegistryMap = normalizeCaches(data.caches);
    delete caches[cacheName];
    setMapField(data, 'caches', caches);
  });
}

function getCacheRegistry(): Record<string, CacheEntry> {
  return loadCacheRegistry();
}

function getCacheEntry(cacheName: string): CacheEntry | null {
  return loadCacheRegistry()[cacheName] || null;
}

export {
  getCacheEntry,
  getCacheRegistry,
  getRegistry,
  getRegistryEntry,
  loadCacheRegistry,
  loadRegistry,
  normalizeCacheEntry,
  normalizeEntry,
  registerCache,
  registerVm,
  saveCacheRegistry,
  saveRegistry,
  unregisterCache,
  unregisterVm,
};
