import { handleError } from './helpers.js';
import { limaStatus } from '../lima.js';
import { getRegistry } from '../registry.js';

// ---------------------------------------------------------------------------
// pi-sandbox list
//
// Lists all pi-sandbox VMs with their current status and project directory.
// Reads the VM registry to know which VMs belong to pi-sandbox (vs other
// Lima VMs). Checks live status for each registered VM.
// ---------------------------------------------------------------------------

export async function list() {
  try {
    const registry = getRegistry();
    const entries = Object.entries(registry);

    if (entries.length === 0) {
      console.log('No sandboxes created yet.');
      return;
    }

    // Gather status for each registered VM
    const rows = [];
    for (const [vmName, projectDir] of entries) {
      let vmStatus;
      try {
        const status = limaStatus(vmName);
        vmStatus = status || 'Unknown';
      } catch {
        vmStatus = 'Unknown';
      }
      rows.push({ name: vmName, status: vmStatus, dir: projectDir });
    }

    // Calculate column widths for padding
    const nameWidth = Math.max('NAME'.length, ...rows.map(r => r.name.length));
    const statusWidth = Math.max('STATUS'.length, ...rows.map(r => r.status.length));

    // Print header
    const header = [
      'NAME'.padEnd(nameWidth),
      'STATUS'.padEnd(statusWidth),
      'PROJECT DIR'
    ].join('  ');
    console.log(header);

    // Print rows
    for (const row of rows) {
      const line = [
        row.name.padEnd(nameWidth),
        row.status.padEnd(statusWidth),
        row.dir
      ].join('  ');
      console.log(line);
    }

  } catch (err) {
    handleError(err);
  }
}
