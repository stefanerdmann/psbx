/**
 * `psbx logs` — surface cloud-init provisioning logs for the project
 * VM and its underlying profile cache VM.
 *
 * Provisioning failures most commonly originate in the cache (it runs all
 * the heavy install/setup steps), so cache logs are surfaced even when the
 * project VM does not exist. Stopped VMs are started transiently to fetch
 * their logs and then stopped again — Lima only exposes guest filesystem
 * access through `limactl shell`, which requires a running VM.
 */

import { profileCacheInputs } from '../cache.ts';
import { resolveProfile } from '../config.ts';
import { limaLogs, limaStart, limaStatus, limaStop } from '../lima.ts';
import type { Profile } from '../types.ts';
import { errorMessage } from '../utils.ts';
import { handleError, resolveContext } from './helpers.ts';

interface FetchLogsResult {
  ok: boolean;
  missing?: boolean;
  output?: string;
  error?: unknown;
}

function fetchLogs(vmName: string): FetchLogsResult {
  const status = limaStatus(vmName);
  if (status === null) return { ok: false, missing: true };

  let started = false;
  if (status !== 'Running') {
    console.error(`Starting '${vmName}' transiently to read its logs...`);
    try {
      limaStart(vmName);
      started = true;
    } catch (err: unknown) {
      return { ok: false, error: err };
    }
  }

  try {
    return { ok: true, output: limaLogs(vmName) };
  } catch (err: unknown) {
    return { ok: false, error: err };
  } finally {
    if (started && limaStatus(vmName) === 'Running') {
      try {
        limaStop(vmName);
      } catch (stopErr: unknown) {
        console.error(
          `Warning: Failed to stop '${vmName}' after reading logs: ${errorMessage(stopErr)}`,
        );
      }
    }
  }
}

function printSection(title: string, vmName: string, result: FetchLogsResult): void {
  const header = `===== ${title} (${vmName}) =====`;
  console.log(header);
  if (result.missing) {
    console.log(`(no Lima VM named '${vmName}')`);
  } else if (!result.ok) {
    console.log(`(failed to read logs: ${errorMessage(result.error)})`);
  } else {
    process.stdout.write(result.output ?? '');
    if (result.output && !result.output.endsWith('\n')) console.log('');
  }
  console.log('');
}

export async function logs(): Promise<void> {
  try {
    const { config, vmName } = resolveContext();

    const projectResult = fetchLogs(vmName);

    let cacheVmName: string | null = null;
    let cacheResult: FetchLogsResult = { ok: false, missing: true };
    let profileError: unknown = null;
    try {
      const profile: Profile = resolveProfile(config);
      cacheVmName = profileCacheInputs(profile, process.cwd()).cacheName;
      cacheResult = fetchLogs(cacheVmName);
    } catch (err: unknown) {
      profileError = err;
    }

    printSection('project VM cloud-init', vmName, projectResult);
    if (cacheVmName) {
      printSection('profile cache VM cloud-init', cacheVmName, cacheResult);
    } else {
      console.log('===== profile cache VM cloud-init =====');
      console.log(`(could not resolve profile for cwd: ${errorMessage(profileError)})`);
      console.log('');
    }

    if (projectResult.missing && cacheResult.missing) {
      console.error(
        `Error: Neither sandbox '${vmName}' nor its profile cache exists. Nothing to show.`,
      );
      process.exit(1);
    }
  } catch (err: unknown) {
    handleError(err);
  }
}
