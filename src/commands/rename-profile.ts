/**
 * Rename a profile: moves the profile directory and updates all
 * references in config.json (defaultProfile, VM registry entries,
 * cache registry entries).
 *
 * Cache VMs are content-addressed and do not encode the profile name
 * in their hash inputs, so they remain valid after the rename — only
 * the `CacheEntry.profile` metadata field is updated.
 */

export const DESCRIPTION = 'Rename a profile';

import { existsSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { getProfilesDir, loadConfig, saveConfig } from '../config.ts';
import { getCacheRegistry, getRegistry, saveCacheRegistry, saveRegistry } from '../registry.ts';
import { handleError } from './helpers.ts';

interface RenameProfileOptions {
  force?: boolean;
}

export async function renameProfile(
  src: string | undefined,
  dest: string | undefined,
  options: RenameProfileOptions = {},
): Promise<void> {
  try {
    if (!src || !dest) {
      throw new Error(
        'Both source and destination profile names are required.\n' +
          'Usage: psbx profile rename <src> <dest>',
      );
    }

    if (src === dest) {
      throw new Error('Source and destination profile names are identical.');
    }

    const profilesDir = getProfilesDir();
    const srcDir = join(profilesDir, src);
    const destDir = join(profilesDir, dest);

    if (!existsSync(srcDir)) {
      throw new Error(`Profile "${src}" not found at ${srcDir}.`);
    }

    if (existsSync(destDir)) {
      if (!options.force) {
        throw new Error(
          `Profile "${dest}" already exists at ${destDir}. Use -f/--force to overwrite.`,
        );
      }
      rmSync(destDir, { recursive: true, force: true });
    }

    // 1. Rename the profile directory
    renameSync(srcDir, destDir);

    // 2. Update defaultProfile in config.json
    const config = loadConfig();
    if (config.defaultProfile === src) {
      config.defaultProfile = dest;
      saveConfig(config);
    }

    // 3. Update VM registry entries
    const registry = getRegistry();
    let vmUpdates = 0;
    for (const entry of Object.values(registry)) {
      if (entry.profile === src) {
        entry.profile = dest;
        vmUpdates++;
      }
    }
    if (vmUpdates > 0) {
      saveRegistry(registry);
    }

    // 4. Update cache registry entries
    const caches = getCacheRegistry();
    let cacheUpdates = 0;
    for (const entry of Object.values(caches)) {
      if (entry.profile === src) {
        entry.profile = dest;
        cacheUpdates++;
      }
    }
    if (cacheUpdates > 0) {
      saveCacheRegistry(caches);
    }

    console.log(`Renamed profile "${src}" to "${dest}".`);
    if (vmUpdates > 0) {
      console.log(`Updated ${vmUpdates} VM registry entry(s).`);
    }
    if (cacheUpdates > 0) {
      console.log(`Updated ${cacheUpdates} cache registry entry(s).`);
    }
    if (config.defaultProfile === dest) {
      console.log(`Updated default profile to "${dest}".`);
    }
  } catch (err: unknown) {
    handleError(err);
  }
}
