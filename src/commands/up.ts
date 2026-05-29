/** Resolves the sandbox lifecycle (create → recreate → start → shell). */

export const DESCRIPTION = 'Bring sandbox up: create, start, and enter in one step';

export const HELP_TEXT =
  'Flow:\n' +
  '  1. create   — when no VM exists yet (clone from profile cache, finalize, register)\n' +
  '  2. recreate — when the VM exists but is inconsistent with the registry\n' +
  '  3. start    — when the VM exists, is consistent, and is stopped\n' +
  '  4. shell    — run the profile defaultCmd or open a plain shell with --shell\n\n' +
  'The --only-create / --only-recreate / --only-start / --force-recreate flags\n' +
  'pin the flow to a specific phase and are mutually exclusive.';

import { cloneVmFromProfileCache } from '../cache.ts';
import { resolveProfile } from '../config.ts';
import { finalizeVm } from '../finalize.ts';
import { limaCheckProvisioning, limaDelete, limaResume, limaShell, limaStatus } from '../lima.ts';
import { registerVm, unregisterVm } from '../registry.ts';
import { FinalizerStatus, LimaStatus, type Profile, type RegistryEntry } from '../types.ts';
import { printValidation, validateConfig } from '../validate.ts';
import {
  confirm,
  finalizeAndRegister,
  handleError,
  hashDefaultCmd,
  hashFinalizerConfig,
  hashLimaConfig,
  hashShellEnvAllowlist,
  prepareProjectState,
  provisionVm,
  resolveContext,
  safeRealpath,
  stopIfRunning,
} from './helpers.ts';

interface UpOptions {
  profile?: string;
  shell?: boolean;
  onlyCreate?: boolean;
  onlyRecreate?: boolean;
  onlyStart?: boolean;
  forceRecreate?: boolean;
  limactlArgs?: string[];
}

interface DetectMismatchesOptions {
  existsAsVm: boolean;
  existsInRegistry: boolean;
  registryEntry: RegistryEntry | null;
  profile: Profile;
  projectDir: string;
}

interface RecreateOptions {
  vmName: string;
  profile: Profile;
  projectDir: string;
  options: UpOptions;
}

interface CreateVmOptions extends RecreateOptions {
  label: string;
}

interface HandleExistingVmOptions {
  vmName: string;
  profile: Profile;
  projectDir: string;
  registryEntry: RegistryEntry;
  status: string | null;
  options: UpOptions;
}

// ---------------------------------------------------------------------------
// psbx up
// ---------------------------------------------------------------------------

export async function up(options: UpOptions = {}): Promise<void> {
  try {
    // Validate mutually exclusive flags
    const onlyFlags = [
      options.onlyCreate,
      options.onlyRecreate,
      options.onlyStart,
      options.forceRecreate,
    ].filter(Boolean);
    if (onlyFlags.length > 1) {
      console.error(
        'Error: --only-create, --only-recreate, --only-start, and --force-recreate are mutually exclusive.',
      );
      process.exit(1);
    }

    const { vmName, projectDir, registryEntry, config } = resolveContext(options);

    // Sticky profile: for an existing VM, default to the profile recorded in
    // the registry unless --profile was given explicitly. If that profile was
    // deleted/renamed, give a single actionable remediation line (F8).
    const profileOverride = options.profile || (registryEntry?.profile ?? undefined);
    let profile: Profile;
    try {
      profile = resolveProfile(config, profileOverride);
    } catch (err: unknown) {
      if (!options.profile && registryEntry?.profile) {
        throw new Error(
          `Sandbox '${vmName}' was created with profile '${registryEntry.profile}', which is no longer available.\n` +
            `Re-create it with \`psbx profile init ${registryEntry.profile}\`, or pick another with \`psbx up --profile <name>\`.`,
        );
      }
      throw err;
    }

    const validation = validateConfig(profile, projectDir);
    if (!printValidation(validation)) {
      process.exit(1);
    }

    const status = limaStatus(vmName);
    const existsAsVm = status !== null;
    const existsInRegistry = registryEntry !== null;

    // Collect specific recreate-worthy mismatch reasons between the requested
    // configuration and the registry entry.
    const mismatches = detectMismatches({
      existsAsVm,
      existsInRegistry,
      registryEntry,
      profile,
      projectDir,
    });
    const isInconsistent = mismatches.length > 0;

    // --only-create: precondition is VM must not exist
    if (options.onlyCreate) {
      if (existsAsVm) {
        console.error(`Error: Sandbox '${vmName}' already exists (status: ${status}).`);
        process.exit(1);
      }
      createVm({
        vmName,
        profile,
        projectDir,
        options,
        label: 'Creating',
      });
      return;
    }

    // --only-recreate: precondition is VM must exist
    if (options.onlyRecreate) {
      if (!existsAsVm) {
        console.error(`Error: Sandbox '${vmName}' does not exist. Cannot recreate.`);
        process.exit(1);
      }
      await doRecreate({ vmName, profile, projectDir, options });
      return;
    }

    // --only-start: precondition is VM must exist and be stopped
    if (options.onlyStart) {
      if (!existsAsVm) {
        console.error(`Error: Sandbox '${vmName}' does not exist.`);
        process.exit(1);
      }
      warnIgnoredLimactlArgs(options.limactlArgs);
      if (status === LimaStatus.Running) {
        console.log(`Sandbox '${vmName}' is already running.`);
        return;
      }
      console.log(`Starting sandbox '${vmName}'...`);
      limaResume(vmName);
      limaCheckProvisioning(vmName);
      console.log(`Sandbox '${vmName}' is running.`);
      return;
    }

    // --force-recreate: recreate if VM exists, create otherwise (with warning),
    // then continue to shell (like the default flow)
    if (options.forceRecreate) {
      if (!existsAsVm) {
        console.warn(
          `Warning: Sandbox '${vmName}' does not exist. Creating instead of recreating.`,
        );
        createVm({
          vmName,
          profile,
          projectDir,
          options,
          label: 'Creating',
        });
      } else {
        await doRecreate({ vmName, profile, projectDir, options });
      }
    } else if (!existsAsVm && !existsInRegistry) {
      // Need to create
      createVm({
        vmName,
        profile,
        projectDir,
        options,
        label: 'Creating',
      });
    } else if (isInconsistent) {
      // Inconsistent state — recreate
      const reasonList = mismatches.map((r) => `  - ${r}`).join('\n');
      const confirmed = await confirm(
        `Sandbox '${vmName}' is inconsistent with the requested configuration:\n${reasonList}\nRecreate? [y/N] `,
      );
      if (!confirmed) {
        console.log('Aborted.');
        return;
      }
      await doRecreate({ vmName, profile, projectDir, options });
    } else {
      await handleExistingConsistentVm({
        vmName,
        profile,
        projectDir,
        registryEntry: registryEntry as RegistryEntry,
        status,
        options,
      });
    }

    // Now enter the shell. shellEnvAllowlist and defaultCmd are read live
    // from the profile — the registry is no longer consulted for these.
    const shellEnvAllowlist = profile.shellEnvAllowlist || [];
    const defaultCmd = profile.defaultCmd;

    if (options.shell) {
      process.exitCode = limaShell(vmName, { shellEnvAllowlist, command: [] });
    } else {
      const command = defaultCmd ? [defaultCmd] : [];
      process.exitCode = limaShell(vmName, { shellEnvAllowlist, command });
    }
  } catch (err: unknown) {
    handleError(err);
  }
}

function detectMismatches({
  existsAsVm,
  existsInRegistry,
  registryEntry,
  profile,
  projectDir,
}: DetectMismatchesOptions): string[] {
  const mismatches: string[] = [];

  if (existsAsVm && !existsInRegistry) {
    mismatches.push('VM exists but has no registry entry');
  } else if (!existsAsVm && existsInRegistry) {
    mismatches.push('registry entry exists but VM does not');
  } else if (existsAsVm && existsInRegistry && registryEntry) {
    if (registryEntry.profile !== profile.name) {
      mismatches.push(
        `profile: created with '${registryEntry.profile}', requested '${profile.name}'`,
      );
    }
    if (registryEntry.limaConfigHash) {
      try {
        const currentHash = hashLimaConfig(profile, projectDir);
        if (currentHash !== registryEntry.limaConfigHash) {
          mismatches.push(
            'Lima configuration (profile lima.yaml or project .psbx/lima.yaml) has changed since the VM was created',
          );
        }
      } catch {
        // If we can't compute the hash (e.g. missing files), skip this check
      }
    }
    if (registryEntry.finalizerStatus === FinalizerStatus.Pending) {
      mismatches.push('profile finalization did not complete for this VM');
    }
    // Note: finalizerHash mismatch is NOT a recreate-worthy mismatch.
    // The up flow re-runs the finalizer in place when finalizerHash drifts
    // but limaConfigHash still matches (the case where configMount source
    // contents or sub-fields changed without altering the rendered lima.yaml).
  }

  return mismatches;
}

function warnIgnoredLimactlArgs(limactlArgs: string[] | undefined): void {
  if (limactlArgs && limactlArgs.length > 0) {
    console.warn(
      `Warning: Extra limactl arguments were ignored because the VM already exists: ${limactlArgs.join(' ')}`,
    );
    console.warn(
      '  These arguments are only applied during VM creation. Consistency with the existing VM is not guaranteed.',
    );
  }
}

async function doRecreate({
  vmName,
  profile,
  projectDir,
  options,
}: RecreateOptions): Promise<void> {
  stopIfRunning(vmName);

  if (limaStatus(vmName) !== null) {
    console.log(`Deleting sandbox '${vmName}'...`);
    limaDelete(vmName);
    unregisterVm(vmName);
  }

  createVm({
    vmName,
    profile,
    projectDir,
    options,
    label: 'Recreating',
  });
}

function createVm({ vmName, profile, projectDir, options, label }: CreateVmOptions): void {
  const limactlArgs = options.limactlArgs || [];
  if (limactlArgs.length > 0) {
    console.warn(
      'Warning: Profile cache bypassed because extra limactl creation arguments were supplied.',
    );
    provisionVm({ vmName, profile, projectDir, limactlArgs, label });
    return;
  }

  prepareProjectState(profile, projectDir);
  const { cacheName, cacheKey } = cloneVmFromProfileCache({
    vmName,
    profile,
    projectDir,
    label,
  });

  finalizeAndRegister({ vmName, profile, projectDir, cacheRef: { cacheName, cacheKey } });
}

export { detectMismatches, warnIgnoredLimactlArgs };

/**
 * Reconcile a moved project directory. When the current directory differs
 * from the one recorded for the VM, prompt to update the registry; declining
 * aborts (a name collision with another project's VM would be unsafe).
 */
async function reconcileProjectDir(
  vmName: string,
  projectDir: string,
  registryEntry: RegistryEntry,
): Promise<void> {
  if (safeRealpath(projectDir) === safeRealpath(registryEntry.projectDir)) {
    return;
  }

  console.warn(`Warning: The project directory for sandbox '${vmName}' has changed.`);
  console.warn(`  Registry: ${registryEntry.projectDir}`);
  console.warn(`  Current:  ${projectDir}`);

  const doUpdate = await confirm(
    'Update the project folder and registry entry to the current directory? [y/N] ',
  );
  if (!doUpdate) {
    console.error(`Error: Sandbox '${vmName}' already exists for a different project directory.`);
    process.exit(1);
  }
  registerVm(vmName, { ...registryEntry, projectDir });
  console.log(`Registry entry for '${vmName}' updated to: ${projectDir}`);
}

/**
 * Bring up a VM that already exists and is consistent with the requested
 * config: reconcile a moved project dir, start it if stopped, re-finalize
 * in place when finalizer inputs drifted (lima.yaml unchanged), and refresh
 * the runtime hashes the registry stores for visibility.
 */
async function handleExistingConsistentVm({
  vmName,
  profile,
  projectDir,
  registryEntry,
  status,
  options,
}: HandleExistingVmOptions): Promise<void> {
  // limactlArgs only apply at creation; warn that they are ignored here.
  warnIgnoredLimactlArgs(options.limactlArgs);
  await reconcileProjectDir(vmName, projectDir, registryEntry);

  if (status !== LimaStatus.Running) {
    console.log(`Starting sandbox '${vmName}'...`);
    limaResume(vmName);
    limaCheckProvisioning(vmName);
    console.log(`Sandbox '${vmName}' is running.`);
  }

  // In-place re-finalize when finalizerHash drifted but limaConfigHash still
  // matches (configMounts source contents, sessions[], or guestTarget
  // sub-fields changed without altering the rendered lima.yaml).
  const newFinalizerHash = hashFinalizerConfig(profile);
  if (registryEntry.finalizerHash !== newFinalizerHash) {
    console.log(`Re-running finalizer for sandbox '${vmName}'...`);
    finalizeVm(vmName, profile);
    registerVm(vmName, {
      ...registryEntry,
      finalizerHash: newFinalizerHash,
      finalizerStatus: FinalizerStatus.Done,
    });
  }

  hotUpdateRuntimeHashes(vmName, profile, registryEntry);
}

/**
 * Refresh the read-live hashes (shellEnvAllowlist, defaultCmd) so the registry
 * reflects the current profile. These fields are consulted live at shell
 * launch, so the refresh is purely informational drift tracking.
 */
function hotUpdateRuntimeHashes(
  vmName: string,
  profile: Profile,
  registryEntry: RegistryEntry,
): void {
  const newShellHash = hashShellEnvAllowlist(profile);
  const newDefaultCmdHash = hashDefaultCmd(profile);
  if (
    registryEntry.shellEnvAllowlistHash !== newShellHash ||
    registryEntry.defaultCmdHash !== newDefaultCmdHash
  ) {
    registerVm(vmName, {
      ...registryEntry,
      shellEnvAllowlistHash: newShellHash,
      defaultCmdHash: newDefaultCmdHash,
    });
  }
}
