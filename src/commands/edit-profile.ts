import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { getProfilesDir, loadConfig } from '../config.ts';
import { handleError } from './helpers.ts';

interface EditProfileOptions {
  file?: string;
}

// ---------------------------------------------------------------------------
// psbx profile edit [profile] [--file <file>]
//
// Opens the profile directory (or a specific file) in $EDITOR.
// ---------------------------------------------------------------------------

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
      const resolved = KNOWN_FILES[options.file] || options.file;
      target = join(profileDir, resolved);
      if (!existsSync(target)) {
        throw new Error(`File not found: ${target}`);
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
