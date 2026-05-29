import { limaDelete, limaStatus } from '../lima.ts';
import { getRegistry, unregisterVm } from '../registry.ts';
import {
  assertProjectDirMatches,
  assertVmExists,
  confirm,
  handleError,
  resolveContext,
  stopIfRunning,
} from './helpers.ts';

export const DESCRIPTION = 'Delete a VM (with confirmation)';

export const HELP_TEXT =
  'Session data survives deletion because it lives in the project directory\n' +
  '(<projectDir>/.agents/sessions/), not inside the VM.';

interface DeleteOptions {
  force?: boolean;
  allRegistered?: boolean;
}

function destroyVm(vmName: string): void {
  stopIfRunning(vmName);
  console.log(`Deleting sandbox '${vmName}'...`);
  limaDelete(vmName);
  unregisterVm(vmName);
}

async function deleteOne(vmName: string, options: DeleteOptions): Promise<void> {
  assertVmExists(vmName);

  if (!options.force) {
    const yes = await confirm(`Are you sure you want to delete sandbox '${vmName}'? [y/N] `);
    if (!yes) {
      console.log('Deletion canceled.');
      return;
    }
  }

  destroyVm(vmName);
  console.log(`Sandbox '${vmName}' has been deleted.`);
}

export async function del(
  vmNameArg: string | undefined,
  options: DeleteOptions = {},
): Promise<void> {
  try {
    if (options.allRegistered) {
      const names = Object.keys(getRegistry());

      if (names.length === 0) {
        console.log('No registered sandboxes to delete.');
        return;
      }

      if (!options.force) {
        const yes = await confirm(`Delete all ${names.length} registered sandbox(es)? [y/N] `);
        if (!yes) {
          console.log('Deletion canceled.');
          return;
        }
      }

      for (const name of names) {
        if (limaStatus(name) === null) {
          console.log(`Sandbox '${name}' does not exist (removing from registry).`);
          unregisterVm(name);
          continue;
        }
        destroyVm(name);
        console.log(`Sandbox '${name}' deleted.`);
      }

      console.log('All registered sandboxes have been deleted.');
      return;
    }

    if (vmNameArg) {
      await deleteOne(vmNameArg, options);
    } else {
      const { vmName, projectDir, registryEntry } = resolveContext();
      await assertProjectDirMatches(vmName, projectDir, registryEntry);
      await deleteOne(vmName, options);
    }
  } catch (err: unknown) {
    handleError(err);
  }
}
