import { existsSync, readdirSync } from 'node:fs';
import { getProfilesDir, loadConfig } from '../config.ts';
import { handleError } from './helpers.ts';

export const DESCRIPTION = 'List all profiles';

interface ListProfilesOptions {
  plain?: boolean;
}

export async function listProfiles(options: ListProfilesOptions = {}): Promise<void> {
  try {
    const config = loadConfig();
    const profilesDir = getProfilesDir();

    if (!existsSync(profilesDir)) {
      if (!options.plain) console.log('No profiles created yet.');
      return;
    }

    const entries = readdirSync(profilesDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
      .map((d) => d.name)
      .sort();

    if (entries.length === 0) {
      if (!options.plain) console.log('No profiles created yet.');
      return;
    }

    if (options.plain) {
      for (const name of entries) {
        console.log(name);
      }
      return;
    }

    const defaultProfile = config.defaultProfile;

    for (const name of entries) {
      const marker = name === defaultProfile ? ' (*)' : '';
      console.log(`${name}${marker}`);
    }
  } catch (err: unknown) {
    handleError(err);
  }
}
