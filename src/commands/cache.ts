/**
 * Caches are content-addressed: their identity is derived from the rendered
 * cache Lima YAML plus a small set of cache-safe inputs (Lima version,
 * provisioning script contents, CA cert contents). Two profiles producing
 * identical cache YAML share one cache. See `src/cache.ts` for the
 * underlying create/clone machinery; this module only exposes the user-
 * facing CLI surface.
 */

export const DESCRIPTION = 'Manage hidden profile caches (list, status, delete)';
export const LIST_DESCRIPTION = 'List all profile caches';
export const STATUS_DESCRIPTION =
  'Show whether the current project already has a matching profile cache';
export const DELETE_DESCRIPTION = 'Delete the matching profile cache for the current project';

import { profileCacheInputs, stopAndDeleteCache } from '../cache.ts';
import { resolveProfile } from '../config.ts';
import { LimaError, limaList, limaStatus } from '../lima.ts';
import { getCacheEntry, getCacheRegistry, getRegistry, unregisterCache } from '../registry.ts';
import type { LimaInstance, Profile, ProfileCacheInputs } from '../types.ts';
import { formatBytes, renderTable } from '../utils.ts';
import { confirm, handleError, resolveContext } from './helpers.ts';

interface CacheCommandOptions {
  profile?: string;
  force?: boolean;
  all?: boolean;
}

function safeLimaList(): LimaInstance[] {
  try {
    return limaList();
  } catch {
    return [];
  }
}

function safeLimaStatus(name: string): string | null {
  try {
    return limaStatus(name);
  } catch {
    return null;
  }
}

function cacheVmMap(): Map<string, LimaInstance> {
  return new Map(safeLimaList().map((vm) => [vm.name, vm]));
}

function deleteCache(cacheName: string): void {
  try {
    stopAndDeleteCache(cacheName);
  } catch (err: unknown) {
    if (err instanceof LimaError && err.message.includes('limactl not found')) {
      unregisterCache(cacheName);
      return;
    }
    throw err;
  }
}

function currentProjectCacheInputs(
  options: CacheCommandOptions,
): { profile: Profile; projectDir: string } & ProfileCacheInputs {
  const { config, projectDir, registryEntry } = resolveContext();
  const profileName = options.profile || registryEntry?.profile || undefined;
  const profile: Profile = resolveProfile(config, profileName);
  return { profile, projectDir, ...profileCacheInputs(profile, projectDir) };
}

export async function listCaches(): Promise<void> {
  try {
    const caches = Object.entries(getCacheRegistry()).sort(([a], [b]) => a.localeCompare(b));
    if (caches.length === 0) {
      console.log('No profile caches created yet.');
      return;
    }

    const vms = cacheVmMap();

    // Cross-reference the VM registry: which project VMs were cloned from
    // each cache (registryEntry.profileCacheName). Caches referenced by no
    // VM are orphaned and can be reclaimed.
    const usedByCache = new Map<string, string[]>();
    for (const [vmName, entry] of Object.entries(getRegistry())) {
      if (entry.profileCacheName) {
        const list = usedByCache.get(entry.profileCacheName) ?? [];
        list.push(vmName);
        usedByCache.set(entry.profileCacheName, list);
      }
    }

    const rows = caches.map(([cacheName, entry]) => {
      const vm = vms.get(cacheName);
      const users = usedByCache.get(cacheName) ?? [];
      return {
        name: cacheName,
        profile: entry.profile,
        status: safeLimaStatus(cacheName) || 'Missing',
        size: formatBytes(vm?.config?.disk),
        usedBy: users.length > 0 ? users.sort().join(', ') : '(orphaned)',
      };
    });

    const tableRows = rows.map((row) => [row.name, row.profile, row.status, row.size, row.usedBy]);
    console.log(renderTable(['NAME', 'PROFILE', 'STATUS', 'SIZE', 'USED BY'], tableRows));

    const orphans = rows.filter((row) => row.usedBy === '(orphaned)');
    if (orphans.length > 0) {
      console.log('');
      console.log(
        `${orphans.length} cache(s) referenced by no VM (orphaned). ` +
          'Reclaim with `psbx cache delete --all` or per-project `psbx cache delete`.',
      );
    }
  } catch (err: unknown) {
    handleError(err);
  }
}

export async function cacheStatus(options: CacheCommandOptions = {}): Promise<void> {
  try {
    const { cacheName } = currentProjectCacheInputs(options);
    const entry = getCacheEntry(cacheName);
    const liveStatus = safeLimaStatus(cacheName);

    if (!entry || liveStatus === null) {
      console.log(`MISS: ${cacheName}`);
      return;
    }

    const vm = cacheVmMap().get(cacheName);
    console.log(`HIT:  ${cacheName}`);
    console.log(`Profile: ${entry.profile}`);
    console.log(`Status:  ${liveStatus}`);
    console.log(`Size:    ${formatBytes(vm?.config?.disk)}`);
  } catch (err: unknown) {
    handleError(err);
  }
}

export async function deleteCacheCommand(options: CacheCommandOptions = {}): Promise<void> {
  try {
    if (options.all) {
      const caches = Object.keys(getCacheRegistry()).sort();
      if (caches.length === 0) {
        console.log('No profile caches to delete.');
        return;
      }

      if (!options.force) {
        const yes = await confirm(`Delete all ${caches.length} profile cache(s)? [y/N] `);
        if (!yes) {
          console.log('Deletion canceled.');
          return;
        }
      }

      for (const cacheName of caches) {
        deleteCache(cacheName);
        console.log(`Deleted profile cache "${cacheName}".`);
      }
      console.log('All profile caches have been deleted.');
      return;
    }

    const { cacheName } = currentProjectCacheInputs(options);
    const exists = getCacheEntry(cacheName) || safeLimaStatus(cacheName) !== null;

    if (!exists) {
      console.log(`No profile cache hit for current project (${cacheName}).`);
      return;
    }

    if (!options.force) {
      const yes = await confirm(`Delete profile cache "${cacheName}"? [y/N] `);
      if (!yes) {
        console.log('Deletion canceled.');
        return;
      }
    }

    deleteCache(cacheName);
    console.log(`Deleted profile cache "${cacheName}".`);
  } catch (err: unknown) {
    handleError(err);
  }
}
