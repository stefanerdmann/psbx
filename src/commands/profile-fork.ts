/**
 * `pi-sandbox profile fork <new-profile>` — snapshot the running project
 * VM's profile (plus exfiltrated guest config from each configMount) into
 * a brand-new profile, then rebase the current VM onto that profile.
 *
 * Because the rendered Lima YAML is byte-identical, the new profile
 * shares the existing content-addressed cache; no restart or recreate is
 * required and only the registry pointer is rewritten.  This is the
 * primary "snapshot my agent state" workflow.
 */

import { cpSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { getProfilesDir, getVmName, loadConfig, resolveProfile } from '../config.ts';
import { limaCopyFromVm, limaStatus } from '../lima.ts';
import { getRegistryEntry, registerVm } from '../registry.ts';
import { expandGuestHome } from '../template.ts';
import type { ConfigMount, Profile } from '../types.ts';
import { errorMessage } from '../utils.ts';
import { handleError, hashFinalizerConfig, profileHashes } from './helpers.ts';

type CopyFromVm = typeof limaCopyFromVm;

function exfiltrateConfigMounts(
  vmName: string,
  targetProfileDir: string,
  configMounts: ConfigMount[],
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

      for (const ex of mount.exfiltrateExcludes || []) {
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

export async function profileFork(newProfileName: string | undefined): Promise<void> {
  try {
    if (!newProfileName) {
      throw new Error('New profile name is required. Usage: pi-sandbox profile fork <new-profile>');
    }

    const vmName = getVmName();
    const entry = getRegistryEntry(vmName);
    if (!entry) {
      throw new Error(
        `No registry entry for sandbox '${vmName}'. Run \`pi-sandbox up\` to create it first.`,
      );
    }
    if (!entry.profile) {
      throw new Error(`Registry entry for '${vmName}' has no associated profile.`);
    }

    const status = limaStatus(vmName);
    if (status === null) {
      throw new Error(`Sandbox '${vmName}' does not exist.`);
    }
    if (status !== 'Running') {
      throw new Error(
        `Sandbox '${vmName}' must be running to fork its profile (current status: ${status}). Start it with \`pi-sandbox up\` first.`,
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
    const stagingDir = mkdtempSync(join(tmpdir(), `pi-sandbox-fork-${newProfileName}-`));
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
      exfiltrateConfigMounts(vmName, stagingDir, sourceProfile.configMounts);

      renameSync(stagingDir, targetDir);
    } catch (err: unknown) {
      rmSync(stagingDir, { recursive: true, force: true });
      throw err;
    }

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
      finalizerStatus: 'done',
      finalizerHash: hashFinalizerConfig(newProfile),
    });

    console.log(`Created profile "${newProfileName}" at ${targetDir}`);
    console.log(`Rebased sandbox '${vmName}' onto profile "${newProfileName}".`);
    console.log('No restart required. Edit the new profile to evolve it independently.');
  } catch (err: unknown) {
    handleError(err);
  }
}
