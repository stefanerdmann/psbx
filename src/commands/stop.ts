import { limaStop } from '../lima.ts';
import { assertVmExists, handleError, resolveContext } from './helpers.ts';

interface StopOptions {
  force?: boolean;
}

// ---------------------------------------------------------------------------
// pi-sandbox stop
//
// Stops a running VM. The VM state is preserved — use `start` or `enter`
// to resume it later.
// ---------------------------------------------------------------------------

export async function stop(options: StopOptions = {}): Promise<void> {
  try {
    const { vmName } = resolveContext();
    const status = assertVmExists(vmName);

    if (status !== 'Running') {
      console.log(`Sandbox '${vmName}' is already stopped.`);
      return;
    }

    console.log(`Stopping sandbox '${vmName}'...`);
    limaStop(vmName, { force: options.force });
    console.log(`Sandbox '${vmName}' has been stopped.`);
  } catch (err: unknown) {
    handleError(err);
  }
}
