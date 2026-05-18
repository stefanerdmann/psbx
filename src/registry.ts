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

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { getConfigPath } from './config.ts';
import type { CacheEntry, ConfigFileData, RegistryEntry } from './types.ts';
import { errorMessage, isPlainObject } from './utils.ts';

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
  writeFileSync(configPath, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
}

function loadRegistry(): Record<string, RegistryEntry> {
  const data = readConfigFile();
  const vms = data.vms;
  if (!vms || typeof vms !== 'object' || Array.isArray(vms)) {
    return {};
  }

  const normalized: Record<string, RegistryEntry> = {};
  for (const [vmName, entry] of Object.entries(vms)) {
    const normalizedEntry = normalizeEntry(entry);
    if (normalizedEntry?.projectDir) {
      normalized[vmName] = normalizedEntry;
    }
  }
  return normalized;
}

function loadCacheRegistry(): Record<string, CacheEntry> {
  const data = readConfigFile();
  const caches = data.caches;
  if (!caches || typeof caches !== 'object' || Array.isArray(caches)) {
    return {};
  }

  const normalized: Record<string, CacheEntry> = {};
  for (const [cacheName, entry] of Object.entries(caches)) {
    const normalizedEntry = normalizeCacheEntry(entry);
    if (normalizedEntry) {
      normalized[cacheName] = normalizedEntry;
    }
  }
  return normalized;
}

function saveRegistry(registry: RegistryMap): void {
  try {
    const data = readConfigFile();
    if (registry && Object.keys(registry).length > 0) {
      data.vms = registry as Record<string, RegistryEntry>;
    } else {
      delete data.vms;
    }
    writeConfigFile(data);
  } catch (err: unknown) {
    console.warn(`Warning: Could not save VM registry: ${errorMessage(err)}`);
  }
}

function saveCacheRegistry(caches: CacheRegistryMap): void {
  try {
    const data = readConfigFile();
    if (caches && Object.keys(caches).length > 0) {
      data.caches = caches as Record<string, CacheEntry>;
    } else {
      delete data.caches;
    }
    writeConfigFile(data);
  } catch (err: unknown) {
    console.warn(`Warning: Could not save cache registry: ${errorMessage(err)}`);
  }
}

function registerVm(vmName: string, entry: unknown): void {
  const registry: RegistryMap = loadRegistry();
  registry[vmName] = normalizeEntry(entry);
  saveRegistry(registry);
}

function unregisterVm(vmName: string): void {
  const registry: RegistryMap = loadRegistry();
  delete registry[vmName];
  saveRegistry(registry);
}

function getRegistry(): Record<string, RegistryEntry> {
  return loadRegistry();
}

function getRegistryEntry(vmName: string): RegistryEntry | null {
  return loadRegistry()[vmName] || null;
}

function registerCache(cacheName: string, entry: unknown): void {
  const caches: CacheRegistryMap = loadCacheRegistry();
  caches[cacheName] = normalizeCacheEntry(entry);
  saveCacheRegistry(caches);
}

function unregisterCache(cacheName: string): void {
  const caches: CacheRegistryMap = loadCacheRegistry();
  delete caches[cacheName];
  saveCacheRegistry(caches);
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
