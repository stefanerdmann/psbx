/**
 * Because the rendered Lima YAML is byte-identical, the new profile
 * shares the existing content-addressed cache; no restart or recreate is
 * required and only the registry pointer is rewritten.
 */

export const DESCRIPTION =
  "Snapshot the current project VM's profile (plus exfiltrated guest config) into a new profile and rebase the VM onto it (pass --no-rebase to skip the rebase)";

import { cpSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { getProfilesDir, getVmName, loadConfig, resolveProfile } from '../config.ts';
import { limaCopyFromVm, limaStatus } from '../lima.ts';
import { getRegistryEntry, registerVm } from '../registry.ts';
import { expandGuestHome } from '../template.ts';
import {
  type ConfigMount,
  FinalizerStatus,
  LimaStatus,
  type Profile,
  type SessionMount,
} from '../types.ts';
import { errorMessage } from '../utils.ts';
import {
  assertProjectDirMatches,
  handleError,
  hashFinalizerConfig,
  profileHashes,
} from './helpers.ts';

type CopyFromVm = typeof limaCopyFromVm;

/**
 * Relative paths (within a configMount's exfiltrated target) of the session
 * symlinks the finalizer plants in the guest from `sessions[].guestSymlink`.
 *
 * These links are created *inside the VM* and point at guest-only workspace
 * paths (`<guest-workdir>/.agents/...`); they were never part of the host
 * profile.  Exfiltrating them would write a dangling symlink into the new
 * profile, which later breaks `hashFinalizerConfig` (it follows symlinks and
 * would ENOENT on the dangling target).  Drop them so the forked profile
 * mirrors the original host profile.
 */
function guestSymlinkExcludesFor(mount: ConfigMount, sessions: SessionMount[]): string[] {
  const targetRoot = `${expandGuestHome(mount.guestTarget).replace(/\/+$/, '')}/`;
  const excludes: string[] = [];
  for (const session of sessions || []) {
    if (!session.guestSymlink) continue;
    const linkPath = expandGuestHome(session.guestSymlink).replace(/\/+$/, '');
    if (linkPath === targetRoot.replace(/\/$/, '')) continue; // link *is* the target
    if (linkPath.startsWith(targetRoot)) {
      excludes.push(linkPath.slice(targetRoot.length));
    }
  }
  return excludes;
}

function exfiltrateConfigMounts(
  vmName: string,
  targetProfileDir: string,
  configMounts: ConfigMount[],
  sessions: SessionMount[] = [],
  copyFn: CopyFromVm = limaCopyFromVm,
): void {
  if (!Array.isArray(configMounts) || configMounts.length === 0) {
    return;
  }

  for (const mount of configMounts) {
    const targetPath = join(targetProfileDir, mount.source);
    const parentDir = dirname(targetPath);
    rmSync(targetPath, { recursive: true, force: true });
    mkdirSync(parentDir, { recursive: true });

    const guestPath = expandGuestHome(mount.guestTarget);
    try {
      mkdirSync(targetPath, { recursive: true });
      const stagingParent = join(parentDir, `.exfiltrate-${mount.name}`);
      rmSync(stagingParent, { recursive: true, force: true });
      mkdirSync(stagingParent, { recursive: true });
      try {
        copyFn(vmName, guestPath, stagingParent);
        // limactl copy -r uses rsync (when available) which adds a trailing
        // slash to the source path, causing contents to be placed directly
        // into stagingParent instead of a subdirectory.  When rsync is not
        // available Lima falls back to scp which copies the directory itself
        // as a child of the destination.  Handle both cases.
        const copiedDir = join(stagingParent, basename(guestPath));
        rmSync(targetPath, { recursive: true, force: true });
        if (existsSync(copiedDir)) {
          renameSync(copiedDir, targetPath);
        } else {
          renameSync(stagingParent, targetPath);
        }
      } finally {
        rmSync(stagingParent, { recursive: true, force: true });
      }

      for (const ex of [
        ...(mount.exfiltrateExcludes || []),
        ...guestSymlinkExcludesFor(mount, sessions),
      ]) {
        rmSync(join(targetPath, ex), { recursive: true, force: true });
      }
    } catch (err: unknown) {
      mkdirSync(targetPath, { recursive: true });
      console.warn(
        `Warning: Could not copy ${guestPath} from VM "${vmName}": ${errorMessage(err)}`,
      );
    }
  }
}

export { exfiltrateConfigMounts };

export interface ProfileForkOptions {
  rebase?: boolean;
}

export async function profileFork(
  newProfileName: string | undefined,
  options: ProfileForkOptions = {},
): Promise<void> {
  try {
    if (!newProfileName) {
      throw new Error('New profile name is required. Usage: psbx profile fork <new-profile>');
    }

    const vmName = getVmName();
    const entry = getRegistryEntry(vmName);
    if (!entry) {
      throw new Error(
        `No registry entry for sandbox '${vmName}'. Run \`psbx up\` to create it first.`,
      );
    }
    if (!entry.profile) {
      throw new Error(`Registry entry for '${vmName}' has no associated profile.`);
    }

    await assertProjectDirMatches(vmName, process.cwd(), entry);

    const status = limaStatus(vmName);
    if (status === null) {
      throw new Error(`Sandbox '${vmName}' does not exist.`);
    }
    if (status !== LimaStatus.Running) {
      throw new Error(
        `Sandbox '${vmName}' must be running to fork its profile (current status: ${status}). Start it with \`psbx up\` first.`,
      );
    }

    const profilesDir = getProfilesDir();
    const targetDir = join(profilesDir, newProfileName);
    if (existsSync(targetDir)) {
      throw new Error(`Profile already exists at ${targetDir}`);
    }

    const config = loadConfig();
    const sourceProfile: Profile = resolveProfile(config, entry.profile);

    mkdirSync(profilesDir, { recursive: true });

    // Stage the new profile so a mid-flight failure leaves no half-built
    // profile behind.
    const stagingDir = mkdtempSync(join(tmpdir(), `psbx-fork-${newProfileName}-`));
    rmSync(stagingDir, { recursive: true, force: true });

    try {
      cpSync(sourceProfile.dir, stagingDir, {
        recursive: true,
        dereference: false,
        errorOnExist: false,
        force: false,
      });

      console.log(
        `Exfiltrating guest config from sandbox '${vmName}' into profile "${newProfileName}"...`,
      );
      exfiltrateConfigMounts(
        vmName,
        stagingDir,
        sourceProfile.configMounts,
        sourceProfile.sessions,
      );

      renameSync(stagingDir, targetDir);
    } catch (err: unknown) {
      rmSync(stagingDir, { recursive: true, force: true });
      throw err;
    }

    console.log(`Created profile "${newProfileName}" at ${targetDir}`);

    if (options.rebase !== false) {
      // Resolve the freshly created profile so finalizerHash reflects the
      // exfiltrated contents.
      const newProfile: Profile = resolveProfile(config, newProfileName);

      registerVm(vmName, {
        ...entry,
        profile: newProfileName,
        // Cache name/key are unchanged: cacheKey is derived from the rendered
        // lima.yaml, which we just copied verbatim.
        ...profileHashes(newProfile, entry.projectDir),
        // finalizerStatus stays 'done' — the running guest already reflects
        // the exfiltrated contents (we copied them out of it).
        finalizerStatus: FinalizerStatus.Done,
        finalizerHash: hashFinalizerConfig(newProfile),
      });

      console.log(`Rebased sandbox '${vmName}' onto profile "${newProfileName}".`);
      console.log('No restart required. Edit the new profile to evolve it independently.');
    } else {
      console.log(`Sandbox '${vmName}' remains on profile "${entry.profile}" (--no-rebase).`);
      console.log(
        `Edit the new profile independently and switch with \`psbx up --profile ${newProfileName}\`.`,
      );
    }
  } catch (err: unknown) {
    handleError(err);
  }
}
