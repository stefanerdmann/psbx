import { spawnSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { join, sep } from 'node:path';
import { assertRelativeSubpath, getProfilesDir, loadConfig } from '../config.ts';
import { handleError } from './helpers.ts';

export const DESCRIPTION = 'Open a profile in $EDITOR';

export interface EditProfileOptions {
  file?: string;
}

const KNOWN_FILES: Record<string, string> = {
  lima: 'lima.yaml',
  env: 'env.yaml',
};

export async function editProfile(
  profileName: string | undefined,
  options: EditProfileOptions = {},
): Promise<void> {
  try {
    const config = loadConfig();
    const name = profileName || config.defaultProfile;

    if (!name) {
      throw new Error(
        'No profile specified and no default profile configured.\n' +
          'Usage: psbx profile edit <name>',
      );
    }

    const profilesDir = getProfilesDir();
    const profileDir = join(profilesDir, name);

    if (!existsSync(profileDir)) {
      throw new Error(
        `Profile "${name}" not found at ${profileDir}. Run \`psbx profile init ${name}\` first.`,
      );
    }

    const editorEnv = process.env.EDITOR || process.env.VISUAL || 'vi';
    const editorParts = editorEnv.split(/\s+/).filter(Boolean);
    const editor = editorParts[0] ?? 'vi';
    const editorArgs = editorParts.slice(1);
    let target = profileDir;

    if (options.file) {
      const known = KNOWN_FILES[options.file];
      if (!known) {
        // The command's contract is "edit a file inside the profile".
        // Reject paths that escape the profile directory (e.g.
        // `--file ../../../etc/hosts`).
        assertRelativeSubpath(options.file, 'profile edit --file');
      }
      target = join(profileDir, known || options.file);
      if (!existsSync(target)) {
        throw new Error(`File not found: ${target}`);
      }
      // Defense-in-depth against symlinks inside the profile that point
      // outside it: confine the resolved target to the profile directory.
      const realTarget = realpathSync(target);
      const realProfileDir = realpathSync(profileDir);
      if (realTarget !== realProfileDir && !realTarget.startsWith(realProfileDir + sep)) {
        throw new Error(`Refusing to edit a file outside the profile directory: ${target}`);
      }
    }

    const result = spawnSync(editor, [...editorArgs, target], { stdio: 'inherit' });
    if (result.error) {
      throw new Error(`Could not open editor "${editorEnv}": ${result.error.message}`);
    }
  } catch (err: unknown) {
    handleError(err);
  }
}
