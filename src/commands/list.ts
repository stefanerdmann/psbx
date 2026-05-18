import { existsSync } from 'node:fs';
import { getVmName } from '../config.ts';
import { limaStatus } from '../lima.ts';
import { getRegistry, saveRegistry } from '../registry.ts';
import type { RegistryEntry } from '../types.ts';
import { handleError } from './helpers.ts';

interface ListOptions {
  prune?: boolean;
}

interface VmRow {
  name: string;
  status: string;
  profile: string;
  dir: string;
  isCurrent: boolean;
}

// ---------------------------------------------------------------------------
// pi-sandbox list
//
// Lists all pi-sandbox VMs with their current status and project directory.
// Reads the VM registry to know which VMs belong to pi-sandbox (vs other
// Lima VMs). Checks live status for each registered VM.
//
// --prune  Remove stale entries (VM gone AND project dir missing).
// ---------------------------------------------------------------------------

function isStale(vmName: string, entry: RegistryEntry): boolean {
  const vmExists = limaStatus(vmName) !== null;
  const dirExists = existsSync(entry.projectDir);
  return !vmExists && !dirExists;
}

export async function list(options: ListOptions = {}): Promise<void> {
  try {
    const registry: Record<string, RegistryEntry> = getRegistry();
    const entries: Array<[string, RegistryEntry]> = Object.entries(registry);

    if (entries.length === 0) {
      console.log('No sandboxes created yet.');
      return;
    }

    if (options.prune) {
      let pruned = 0;
      for (const [vmName, entry] of entries) {
        if (isStale(vmName, entry)) {
          delete registry[vmName];
          console.log(`Pruned stale entry: ${vmName}`);
          pruned++;
        }
      }
      if (pruned > 0) {
        saveRegistry(registry);
        console.log(`Removed ${pruned} stale entr${pruned === 1 ? 'y' : 'ies'}.`);
      } else {
        console.log('No stale entries found.');
      }
      return;
    }

    let currentVmName: string | null;
    try {
      currentVmName = getVmName();
    } catch {
      currentVmName = null;
    }

    // Gather status for each registered VM
    const rows: VmRow[] = [];
    for (const [vmName, entry] of entries) {
      let vmStatus: string;
      try {
        const status = limaStatus(vmName);
        vmStatus = status || 'Unknown';
      } catch {
        vmStatus = 'Unknown';
      }

      const stale = isStale(vmName, entry);
      const isCurrent = vmName === currentVmName;

      rows.push({
        name: vmName,
        status: stale ? `${vmStatus} (stale)` : vmStatus,
        profile: entry.profile || '',
        dir: entry.projectDir,
        isCurrent,
      });
    }

    // Calculate column widths for padding
    const nameWidth = Math.max(
      'NAME'.length,
      ...rows.map((r) => r.name.length + (r.isCurrent ? 2 : 0)),
    );
    const statusWidth = Math.max('STATUS'.length, ...rows.map((r) => r.status.length));
    const profileWidth = Math.max('PROFILE'.length, ...rows.map((r) => r.profile.length));

    // Print header
    const header = [
      'NAME'.padEnd(nameWidth),
      'STATUS'.padEnd(statusWidth),
      'PROFILE'.padEnd(profileWidth),
      'WORKDIR',
    ].join('  ');
    console.log(header);

    // Print rows
    for (const row of rows) {
      const displayName = row.isCurrent ? `* ${row.name}` : row.name;
      const line = [
        displayName.padEnd(nameWidth),
        row.status.padEnd(statusWidth),
        row.profile.padEnd(profileWidth),
        row.dir,
      ].join('  ');
      console.log(line);
    }
  } catch (err: unknown) {
    handleError(err);
  }
}
