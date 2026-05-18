/**
 * `pi-sandbox profile delete <name> [--all]` — remove a profile directory
 * from `~/.pi-sandbox/profiles/`.
 *
 * Profile caches are content-addressed (and may be shared after
 * `profile fork`), so after deleting a profile we always sweep orphaned
 * caches that no live registry VM still references.
 */

import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pruneOrphanedCaches } from '../cache.ts';
import { getProfilesDir, loadConfig } from '../config.ts';
import { getRegistry } from '../registry.ts';
import type { RegistryEntry } from '../types.ts';
import { errorMessage } from '../utils.ts';
import { confirm, handleError } from './helpers.ts';

interface DeleteProfileOptions {
  force?: boolean;
  all?: boolean;
}

export async function deleteProfile(
  profileName: string | undefined,
  options: DeleteProfileOptions = {},
): Promise<void> {
  try {
    const _config = loadConfig();
    const profilesDir = getProfilesDir();

    if (options.all) {
      if (!existsSync(profilesDir)) {
        console.log('No profiles directory found.');
        return;
      }

      const entries = readdirSync(profilesDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);

      if (entries.length === 0) {
        console.log('No profiles to delete.');
        return;
      }

      if (!options.force) {
        const yes = await confirm(
          `Delete all ${entries.length} profile(s) (${entries.join(', ')})? [y/N] `,
        );
        if (!yes) {
          console.log('Deletion canceled.');
          return;
        }
      }

      for (const name of entries) {
        rmSync(join(profilesDir, name), { recursive: true, force: true });
        console.log(`Deleted profile "${name}".`);
      }
      pruneCachesAfterProfileChange();

      console.log('All profiles have been deleted.');
      return;
    }

    if (!profileName) {
      throw new Error(
        'Profile name is required. Usage: pi-sandbox profile delete <name>\n' +
          'Use --all to delete all profiles.',
      );
    }

    const targetDir = join(profilesDir, profileName);

    if (!existsSync(targetDir)) {
      throw new Error(`Profile "${profileName}" not found at ${targetDir}`);
    }

    // Check if any VMs use this profile
    if (!options.force) {
      const registry: Record<string, RegistryEntry> = getRegistry();
      const usedBy = Object.entries(registry)
        .filter(([, entry]) => entry.profile === profileName)
        .map(([vmName]) => vmName);
      if (usedBy.length > 0) {
        console.warn(`Warning: Profile "${profileName}" is used by VM(s): ${usedBy.join(', ')}`);
        const yes = await confirm(`Delete profile "${profileName}" anyway? [y/N] `);
        if (!yes) {
          console.log('Deletion canceled.');
          return;
        }
      } else {
        const yes = await confirm(
          `Are you sure you want to delete profile "${profileName}" at ${targetDir}? [y/N] `,
        );
        if (!yes) {
          console.log('Deletion canceled.');
          return;
        }
      }
    }

    rmSync(targetDir, { recursive: true, force: true });
    pruneCachesAfterProfileChange();
    console.log(`Deleted profile "${profileName}".`);
  } catch (err: unknown) {
    handleError(err);
  }
}

// Profile caches are content-addressed and may be shared across profiles
// (especially after `profile fork`). After deleting a profile, garbage-
// collect any caches that no live registry VM still references.
function pruneCachesAfterProfileChange(): void {
  try {
    pruneOrphanedCaches();
  } catch (err: unknown) {
    console.warn(`Warning: Could not prune orphaned profile caches: ${errorMessage(err)}`);
  }
}
