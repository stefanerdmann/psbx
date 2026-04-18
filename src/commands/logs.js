import { resolveContext, handleError } from './helpers.js';
import { limaStatus, limaLogs } from '../lima.js';

// ---------------------------------------------------------------------------
// pi-sandbox logs
//
// Shows the cloud-init provisioning log from inside the VM.
// Useful for debugging failed creates — the log contains all provisioning
// script output including errors.
// ---------------------------------------------------------------------------

export async function logs() {
  try {
    const { vmName } = resolveContext();

    const status = limaStatus(vmName);

    if (status === null) {
      console.error(`Error: Sandbox '${vmName}' does not exist.`);
      process.exit(1);
    }

    if (status !== 'Running') {
      console.error(`Error: Sandbox '${vmName}' is ${status.toLowerCase()}. Start it first to view logs.`);
      process.exit(1);
    }

    const logContent = limaLogs(vmName);
    process.stdout.write(logContent);

  } catch (err) {
    handleError(err);
  }
}
