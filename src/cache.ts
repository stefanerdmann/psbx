/**
 * Per-profile clone-source ("cache") VM lifecycle.
 *
 * `up` creates project VMs by `limactl clone`-ing a stopped, pre-provisioned
 * cache VM and then attaching project-specific mounts + finalizing. The
 * cache's identity is a hash of the rendered cache Lima YAML plus other
 * cache-safe inputs (Lima version, sysprep version, provisioning script
 * contents). This module owns:
 *
 *   - Computing cache inputs (name, key, YAML, version) for a profile.
 *   - Creating a cache on first use, including sysprep so clones get fresh
 *     SSH host keys / machine-id.
 *   - Cloning a project VM from a cache, applying project mounts, resuming.
 *   - Garbage-collecting orphaned caches no live registry VM references.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashRenderedLimaConfig } from './commands/helpers.ts';
import { CACHE_SYSPREP_VERSION, sysprepCacheVm } from './finalize.ts';
import {
  limaCheckProvisioning,
  limaClone,
  limaDelete,
  limaReadInstanceYaml,
  limaResume,
  limaStart,
  limaStatus,
  limaStop,
  limaVersion,
  limaWriteInstanceYaml,
} from './lima.ts';
import {
  getCacheEntry,
  getCacheRegistry,
  getRegistry,
  registerCache,
  unregisterCache,
} from './registry.ts';
import {
  buildCacheLimaConfig,
  buildProjectInstanceLimaYaml,
  stringifyLimaConfig,
} from './template.ts';
import { CacheStatus, LimaStatus, type Profile, type ProfileCacheInputs } from './types.ts';
import { errorMessage } from './utils.ts';

type CreateProfileCacheParams = ProfileCacheInputs & { profile: Profile };

function cacheNameFor(cacheKey: string): string {
  return `psbx-cache-${cacheKey.slice(0, 12)}`;
}

function profileCacheInputs(profile: Profile, projectDir: string): ProfileCacheInputs {
  const config = buildCacheLimaConfig(profile, projectDir);
  const limaVersionValue = limaVersion();
  const cacheKey = hashRenderedLimaConfig(config, {
    kind: 'psbx-profile-cache',
    cacheSchemaVersion: 1,
    limaVersion: limaVersionValue,
    sysprepVersion: CACHE_SYSPREP_VERSION,
  });
  return {
    cacheKey,
    cacheName: cacheNameFor(cacheKey),
    limaVersion: limaVersionValue,
    sysprepVersion: CACHE_SYSPREP_VERSION,
    yaml: stringifyLimaConfig(config),
  };
}

function createProfileCache({
  cacheName,
  cacheKey,
  limaVersion: limaVersionValue,
  profile,
  sysprepVersion,
  yaml,
}: CreateProfileCacheParams): void {
  const tmpDir = mkdtempSync(join(tmpdir(), 'psbx-cache-'));
  const tmpPath = join(tmpDir, 'lima.yaml');
  writeFileSync(tmpPath, yaml, 'utf-8');

  console.log(`Preparing profile cache '${cacheName}'...`);
  console.log(`  Profile: ${profile.name}`);
  console.log('');

  let created = false;
  try {
    limaStart(cacheName, tmpPath);
    created = true;
    limaCheckProvisioning(cacheName);
    sysprepCacheVm(cacheName);
  } catch (err: unknown) {
    if (created) {
      registerCache(cacheName, {
        profile: profile.name,
        cacheKey,
        limaVersion: limaVersionValue,
        sysprepVersion,
        createdAt: new Date().toISOString(),
        status: CacheStatus.Failed,
        failedAt: new Date().toISOString(),
        failureReason: errorMessage(err),
      });
      console.warn(
        `Warning: Profile cache '${cacheName}' failed to provision and was kept for inspection.`,
      );
      console.warn(`Hint: run \`psbx logs\` to view its provisioning output.`);
    }
    throw err;
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
    if (created && limaStatus(cacheName) === LimaStatus.Running) {
      limaStop(cacheName);
    }
  }

  registerCache(cacheName, {
    profile: profile.name,
    cacheKey,
    limaVersion: limaVersionValue,
    sysprepVersion,
    createdAt: new Date().toISOString(),
    status: CacheStatus.Ready,
  });

  console.log(`Profile cache '${cacheName}' is ready.`);
}

function stopAndDeleteCache(cacheName: string): void {
  const status = limaStatus(cacheName);
  if (status === LimaStatus.Running) {
    limaStop(cacheName);
  }
  if (limaStatus(cacheName) !== null) {
    limaDelete(cacheName);
  }
  unregisterCache(cacheName);
}

function pruneOrphanedCaches(keepCacheName?: string): void {
  const referenced = new Set<string>(
    Object.values(getRegistry())
      .map((entry) => entry.profileCacheName)
      .filter(
        (cacheName): cacheName is string => typeof cacheName === 'string' && Boolean(cacheName),
      ),
  );
  if (keepCacheName) {
    referenced.add(keepCacheName);
  }
  for (const cacheName of Object.keys(getCacheRegistry())) {
    if (referenced.has(cacheName)) {
      continue;
    }
    stopAndDeleteCache(cacheName);
  }
}

function ensureProfileCache(profile: Profile, projectDir: string): ProfileCacheInputs {
  const inputs = profileCacheInputs(profile, projectDir);
  const entry = getCacheEntry(inputs.cacheName);
  const status = limaStatus(inputs.cacheName);

  if (status === null) {
    createProfileCache({ ...inputs, profile });
    pruneOrphanedCaches(inputs.cacheName);
    return inputs;
  }

  if (!entry || entry.cacheKey !== inputs.cacheKey || entry.status === CacheStatus.Failed) {
    const reason =
      entry?.status === CacheStatus.Failed
        ? `Previous cache '${inputs.cacheName}' was kept for inspection after a failed provision; rebuilding it now.`
        : `Warning: Existing profile cache '${inputs.cacheName}' is missing valid metadata; rebuilding it.`;
    console.warn(reason);
    stopAndDeleteCache(inputs.cacheName);
    createProfileCache({ ...inputs, profile });
    pruneOrphanedCaches(inputs.cacheName);
    return inputs;
  }

  if (status === LimaStatus.Running) {
    limaStop(inputs.cacheName);
  }

  pruneOrphanedCaches(inputs.cacheName);
  return inputs;
}

function cloneVmFromProfileCache({
  vmName,
  profile,
  projectDir,
  label = 'Creating',
}: {
  vmName: string;
  profile: Profile;
  projectDir: string;
  label?: string;
}): { cacheName: string; cacheKey: string } {
  const { cacheName, cacheKey } = ensureProfileCache(profile, projectDir);
  console.log(`${label} sandbox from profile cache: ${vmName}`);
  console.log(`  Profile: ${profile.name}`);
  console.log(`  Cache:   ${cacheName}`);
  console.log(`  Project: ${projectDir}`);
  console.log('');

  limaClone(cacheName, vmName);
  limaWriteInstanceYaml(
    vmName,
    buildProjectInstanceLimaYaml(limaReadInstanceYaml(vmName), profile, projectDir),
  );
  limaResume(vmName);

  return { cacheName, cacheKey };
}

export {
  cloneVmFromProfileCache,
  ensureProfileCache,
  profileCacheInputs,
  pruneOrphanedCaches,
  stopAndDeleteCache,
};
