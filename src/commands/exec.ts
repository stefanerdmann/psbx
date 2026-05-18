/**
 * `psbx exec` — run a one-off command (or open a plain shell) inside
 * an existing project sandbox.  Resolves the bound profile live so changes
 * to `shellEnvAllowlist` / `defaultCmd` take effect immediately, without a
 * VM recreate.  If the profile has been deleted or renamed, exec degrades
 * gracefully to a shell with no environment passthrough rather than hard
 * failing — the user still needs a way to recover state.
 */

import { getVmName, loadConfig, resolveProfile } from '../config.ts';
import { limaCheckProvisioning, limaResume, limaShell } from '../lima.ts';
import { getRegistryEntry } from '../registry.ts';
import type { Profile } from '../types.ts';
import { errorMessage } from '../utils.ts';
import { assertVmExists, handleError } from './helpers.ts';

interface ExecOptions {
  shell?: boolean;
}

export async function exec(command: string[] = [], options: ExecOptions = {}): Promise<void> {
  try {
    const vmName = getVmName();
    const status = assertVmExists(vmName, { extraHint: 'Create it first with `psbx up`.' });

    if (status !== 'Running') {
      console.log(`Starting sandbox '${vmName}'...`);
      limaResume(vmName);
      limaCheckProvisioning(vmName);
      console.log(`Sandbox '${vmName}' is running.`);
    }

    // shellEnvAllowlist is read live from the profile so profile edits take
    // effect on the next `psbx exec` without recreate or restart. If
    // the profile is missing (deleted/renamed), fall back to passing no env
    // vars so the user can still get a shell to recover state.
    const entry = getRegistryEntry(vmName);
    let shellEnvAllowlist: string[] = [];
    let profile: Profile | null = null;
    try {
      const config = loadConfig();
      profile = resolveProfile(config, entry?.profile);
      shellEnvAllowlist = profile.shellEnvAllowlist || [];
    } catch (err: unknown) {
      console.warn(
        `Warning: Could not resolve profile for '${vmName}' (${errorMessage(err)}). Continuing without shell env allowlist.`,
      );
    }

    let finalCommand: string[];
    if (options.shell) {
      finalCommand = [];
    } else if (command.length > 0) {
      finalCommand = command;
    } else {
      const defaultCmd = profile?.defaultCmd;
      finalCommand = defaultCmd ? [defaultCmd] : [];
    }
    limaShell(vmName, { shellEnvAllowlist, command: finalCommand });
  } catch (err: unknown) {
    handleError(err);
  }
}
