import { resolveContext, handleError } from './helpers.js';
import { limaStatus, limaStop } from '../lima.js';

// ---------------------------------------------------------------------------
// pi-sandbox stop
//
// Stops a running VM. The VM state is preserved — use `start` or `enter`
// to resume it later.
// ---------------------------------------------------------------------------

export async function stop(options = {}) {
  try {
    const { vmName } = resolveContext(options);

    const status = limaStatus(vmName);

    if (status === null) {
      console.error(`Error: Sandbox '${vmName}' does not exist.`);
      process.exit(1);
    }

    if (status !== 'Running') {
      console.log(`Sandbox '${vmName}' is already stopped.`);
      return;
    }

    console.log(`Stopping sandbox '${vmName}'...`);
    limaStop(vmName);
    console.log(`Sandbox '${vmName}' has been stopped.`);

  } catch (err) {
    handleError(err);
  }
}
