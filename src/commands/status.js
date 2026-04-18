import { resolveContext, handleError } from './helpers.js';
import { limaStatus } from '../lima.js';

// ---------------------------------------------------------------------------
// pi-sandbox status
//
// Shows a one-liner with the VM status for the current project directory.
// ---------------------------------------------------------------------------

export async function status() {
  try {
    const { vmName } = resolveContext();

    const vmStatus = limaStatus(vmName);

    if (vmStatus === null) {
      console.log(`${vmName}: Not created`);
    } else {
      console.log(`${vmName}: ${vmStatus}`);
    }

  } catch (err) {
    handleError(err);
  }
}
