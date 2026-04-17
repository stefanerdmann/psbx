import { resolveContext, confirm, handleError } from './helpers.js';
import { limaStatus, limaStop, limaDelete } from '../lima.js';

// ---------------------------------------------------------------------------
// pi-sandbox delete
//
// Deletes the VM for the current project. Prompts for confirmation first.
// If the VM is running, it's stopped before deletion.
//
// Session data survives deletion because it lives in the project directory
// (<projectDir>/.pi-sandbox/sessions/), not inside the VM.
// ---------------------------------------------------------------------------

export async function del() {
  try {
    const { vmName } = resolveContext();

    const status = limaStatus(vmName);

    if (status === null) {
      console.error(`Error: Sandbox '${vmName}' does not exist.`);
      process.exit(1);
    }

    const yes = await confirm(
      `Are you sure you want to delete sandbox '${vmName}'? [y/N] `
    );

    if (!yes) {
      console.log('Deletion canceled.');
      return;
    }

    // Stop the VM first if it's running — limaDelete requires a stopped VM
    if (status === 'Running') {
      console.log(`Stopping sandbox '${vmName}'...`);
      limaStop(vmName);
    }

    console.log(`Deleting sandbox '${vmName}'...`);
    limaDelete(vmName);
    console.log(`Sandbox '${vmName}' has been deleted.`);

  } catch (err) {
    handleError(err);
  }
}
