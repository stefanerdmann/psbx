/**
 * Resolves the bound profile live so changes to `shellEnvAllowlist` /
 * `defaultCmd` take effect immediately without a VM recreate.  If the
 * profile has been deleted or renamed, exec degrades gracefully to a shell
 * with no environment passthrough rather than hard failing.
 */

export const DESCRIPTION = 'Run a one-off command in the sandbox (auto-starts if stopped)';

import { getVmName } from '../config.ts';
import { remountShadowPaths } from '../finalize.ts';
import { limaCheckProvisioning, limaResume, limaShell } from '../lima.ts';
import { getRegistryEntry } from '../registry.ts';
import { LimaStatus } from '../types.ts';
import {
  assertProjectDirMatches,
  assertVmExists,
  handleError,
  resolveProfileForVm,
} from './helpers.ts';

export interface ExecOptions {
  shell?: boolean;
}

export async function exec(command: string[] = [], options: ExecOptions = {}): Promise<void> {
  try {
    const vmName = getVmName();
    const status = assertVmExists(vmName, { extraHint: 'Create it first with `psbx up`.' });
    const entry = getRegistryEntry(vmName);
    await assertProjectDirMatches(vmName, process.cwd(), entry);

    // Resolve profile early so shadow mounts can be re-applied on auto-start.
    // If the profile is missing (deleted/renamed), degrade gracefully.
    let shellEnvAllowlist: string[] = [];
    const { profile, warning } = resolveProfileForVm(vmName);
    if (profile) {
      shellEnvAllowlist = profile.shellEnvAllowlist || [];
    } else {
      console.warn(
        `Warning: Could not resolve profile for '${vmName}' (${warning}). Continuing without shell env allowlist.`,
      );
    }

    if (status !== LimaStatus.Running) {
      console.log(`Starting sandbox '${vmName}'...`);
      limaResume(vmName);
      limaCheckProvisioning(vmName);
      if (profile) {
        remountShadowPaths(vmName, profile);
      }
      console.log(`Sandbox '${vmName}' is running.`);
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
    process.exitCode = limaShell(vmName, { shellEnvAllowlist, command: finalCommand });
  } catch (err: unknown) {
    handleError(err);
  }
}
