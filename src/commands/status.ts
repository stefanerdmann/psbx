/** Detects drift between registry-stored hashes and current profile state. */

export const DESCRIPTION = 'Show VM status, environment, and sync state for the current project';

export const HELP_TEXT =
  'Drift is split by impact:\n' +
  '  - Lima config drift requires a recreate\n' +
  '  - Finalizer drift requires an in-place re-finalize on next `up`\n' +
  '  - shellEnvAllowlist / defaultCmd drift is picked up live on next exec/up';

import { join } from 'node:path';
import { getProfilesDir, LIMA_FILE, loadEnv } from '../config.ts';
import { limaList, limaStatus } from '../lima.ts';
import type { EnvConfig, LimaInstance, Profile, RegistryEntry, SyncDriftItem } from '../types.ts';
import { formatBytes } from '../utils.ts';
import {
  handleError,
  hashDefaultCmd,
  hashFinalizerConfig,
  hashLimaConfig,
  hashShellEnvAllowlist,
  resolveContext,
} from './helpers.ts';

interface StatusOptions {
  json?: boolean;
}

interface StatusJsonInfo {
  name: string;
  status: string;
  profile?: string | null;
  projectDir?: string;
  cpus?: number;
  memory?: string | number;
  disk?: string | number;
  sshPort?: number;
  env?: EnvConfig;
  sync?:
    | { inSync: true }
    | {
        inSync: false;
        drift: SyncDriftItem[];
      };
}

/**
 * Attempts to load the env config for the given registry entry's profile.
 * Returns null if the profile cannot be resolved.
 */
function tryLoadEnv(registryEntry: RegistryEntry | null): EnvConfig | null {
  if (!registryEntry?.profile) return null;
  try {
    const profileDir = `${getProfilesDir()}/${registryEntry.profile}`;
    return loadEnv(profileDir);
  } catch {
    return null;
  }
}

/**
 * Returns the `psbx up` command hint, including `--profile <name>` when
 * the VM's profile is not the currently configured default.
 */
function upHint(profileName: string | null | undefined, defaultProfile: string | null): string {
  if (profileName && profileName !== defaultProfile) {
    return `\`psbx up --profile ${profileName}\``;
  }
  return '`psbx up`';
}

/**
 * Computes sync drift between the registry-stored hashes and the current
 * profile state. Returns an array of { message, guidance } objects.
 */
function computeSyncDrift(
  registryEntry: RegistryEntry | null,
  projectDir: string,
  defaultProfile: string | null,
): SyncDriftItem[] | null {
  if (!registryEntry?.profile) return null;

  const profileDir = `${getProfilesDir()}/${registryEntry.profile}`;
  let env: EnvConfig;
  try {
    env = loadEnv(profileDir);
  } catch {
    return null;
  }

  // Build a profile-like object for the hash functions
  const profile = {
    ...env,
    name: registryEntry.profile,
    dir: profileDir,
    limaPath: join(profileDir, LIMA_FILE),
  } as Profile;

  const drift: SyncDriftItem[] = [];

  // Lima config drift — requires recreate
  if (registryEntry.limaConfigHash) {
    try {
      const currentHash = hashLimaConfig(profile, projectDir);
      if (currentHash !== registryEntry.limaConfigHash) {
        drift.push({
          field: 'limaConfig',
          message: 'Lima configuration has changed',
          guidance: `run ${upHint(registryEntry.profile, defaultProfile)} (will recreate the VM)`,
        });
      }
    } catch {
      // Cannot compute hash (e.g. missing files) — skip
    }
  }

  // Finalizer drift — requires re-finalize (in-place, no recreate)
  if (registryEntry.finalizerHash) {
    try {
      const currentHash = hashFinalizerConfig(profile);
      if (currentHash !== registryEntry.finalizerHash) {
        drift.push({
          field: 'finalizer',
          message: 'Config mount contents or structure have changed',
          guidance: `run ${upHint(registryEntry.profile, defaultProfile)} (will re-finalize in-place)`,
        });
      }
    } catch {
      // Cannot compute hash — skip
    }
  }

  // Finalizer status pending
  if (registryEntry.finalizerStatus === 'pending') {
    drift.push({
      field: 'finalizerStatus',
      message: 'Profile finalization did not complete',
      guidance: `run ${upHint(registryEntry.profile, defaultProfile)} to complete setup`,
    });
  }

  // shellEnvAllowlist drift — picked up live
  if (registryEntry.shellEnvAllowlistHash) {
    try {
      const currentHash = hashShellEnvAllowlist(profile);
      if (currentHash !== registryEntry.shellEnvAllowlistHash) {
        drift.push({
          field: 'shellEnvAllowlist',
          message: 'Shell env allowlist has changed',
          guidance: `picked up on next \`psbx exec\` or ${upHint(registryEntry.profile, defaultProfile)}`,
        });
      }
    } catch {
      // Cannot compute hash — skip
    }
  }

  // defaultCmd drift — picked up live
  if (registryEntry.defaultCmdHash) {
    try {
      const currentHash = hashDefaultCmd(profile);
      if (currentHash !== registryEntry.defaultCmdHash) {
        drift.push({
          field: 'defaultCmd',
          message: 'Default command has changed',
          guidance: `picked up on next \`psbx exec\` or ${upHint(registryEntry.profile, defaultProfile)}`,
        });
      }
    } catch {
      // Cannot compute hash — skip
    }
  }

  return drift;
}

export async function status(options: StatusOptions = {}): Promise<void> {
  try {
    const { vmName, registryEntry, config } = resolveContext();

    const vmStatus = limaStatus(vmName);
    const env = tryLoadEnv(registryEntry);
    const drift =
      vmStatus !== null
        ? computeSyncDrift(registryEntry, process.cwd(), config.defaultProfile)
        : null;

    if (options.json) {
      const info: StatusJsonInfo = { name: vmName, status: vmStatus || 'Not created' };
      if (registryEntry) {
        info.profile = registryEntry.profile || null;
        info.projectDir = registryEntry.projectDir;
      }
      if (vmStatus) {
        const vms: LimaInstance[] = limaList();
        const vm = vms.find((v) => v.name === vmName);
        if (vm) {
          if (vm.config?.cpus) info.cpus = vm.config.cpus;
          if (vm.config?.memory) info.memory = vm.config.memory;
          if (vm.config?.disk) info.disk = vm.config.disk;
          if (vm.sshLocalPort) info.sshPort = vm.sshLocalPort;
        }
      }
      if (env) {
        info.env = env;
      }
      if (drift) {
        info.sync = drift.length === 0 ? { inSync: true } : { inSync: false, drift };
      }
      console.log(JSON.stringify(info, null, 2));
      return;
    }

    if (vmStatus === null) {
      console.log(`${vmName}: Not created`);
      return;
    }

    console.log(`Name:       ${vmName}`);
    console.log(`Status:     ${vmStatus}`);

    if (registryEntry) {
      if (registryEntry.profile) {
        console.log(`Profile:    ${registryEntry.profile}`);
      }
      console.log(`Project:    ${registryEntry.projectDir}`);
    }

    const vms: LimaInstance[] = limaList();
    const vm = vms.find((v) => v.name === vmName);
    if (vm) {
      if (vm.config?.cpus) console.log(`CPUs:       ${vm.config.cpus}`);
      if (vm.config?.memory) console.log(`Memory:     ${formatBytes(vm.config.memory)}`);
      if (vm.config?.disk) console.log(`Disk:       ${formatBytes(vm.config.disk)}`);
      if (vm.sshLocalPort) console.log(`SSH port:   ${vm.sshLocalPort}`);
    }

    // Environment section
    if (env) {
      console.log('');
      console.log('Environment:');
      if (env.defaultCmd) {
        console.log(`  Default cmd:          ${env.defaultCmd}`);
      }
      if (env.shellEnvAllowlist && env.shellEnvAllowlist.length > 0) {
        console.log(`  Shell env allowlist:  ${env.shellEnvAllowlist.join(', ')}`);
      }
      if (env.configMounts && env.configMounts.length > 0) {
        console.log('  Config mounts:');
        for (const mount of env.configMounts) {
          console.log(`    ${mount.name} (${mount.source}) → ${mount.guestTarget}`);
        }
      }
    }

    // Sync section
    if (drift) {
      console.log('');
      if (drift.length === 0) {
        console.log('Sync:       ✓ In sync');
      } else {
        console.log('Sync:       ✗ Out of sync');
        for (const item of drift) {
          console.log(`  - ${item.message}`);
          console.log(`    → ${item.guidance}`);
        }
      }
    }
  } catch (err: unknown) {
    handleError(err);
  }
}

export { computeSyncDrift, formatBytes, tryLoadEnv, upHint };
