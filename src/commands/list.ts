import { existsSync } from 'node:fs';
import { getVmName } from '../config.ts';
import { limaStatus } from '../lima.ts';
import { getRegistry, saveRegistry } from '../registry.ts';
import type { RegistryEntry } from '../types.ts';
import { renderTable } from '../utils.ts';
import { handleError } from './helpers.ts';

export const DESCRIPTION = 'List all psbx VMs';

export interface ListOptions {
  prune?: boolean;
}

interface VmRow {
  name: string;
  status: string;
  profile: string;
  dir: string;
  isCurrent: boolean;
}

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
    const headers = ['NAME', 'STATUS', 'PROFILE', 'WORKDIR'];
    const tableRows = rows.map((row) => [
      row.isCurrent ? `* ${row.name}` : row.name,
      row.status,
      row.profile,
      row.dir,
    ]);
    console.log(renderTable(headers, tableRows));
  } catch (err: unknown) {
    handleError(err);
  }
}
