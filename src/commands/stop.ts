import { limaStop } from '../lima.ts';
import { LimaStatus } from '../types.ts';
import { assertVmExists, handleError, resolveContext } from './helpers.ts';

export const DESCRIPTION = 'Stop a running VM';

export interface StopOptions {
  force?: boolean;
}

export async function stop(options: StopOptions = {}): Promise<void> {
  try {
    const { vmName } = resolveContext();
    const status = assertVmExists(vmName);

    if (status !== LimaStatus.Running) {
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
