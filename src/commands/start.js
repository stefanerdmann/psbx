import { resolveContext, handleError } from './helpers.js';
import { limaStatus, limaResume } from '../lima.js';

// ---------------------------------------------------------------------------
// pi-sandbox start
//
// Starts (resumes) a stopped VM. Does NOT provision a new VM — use `create`
// for that.
// ---------------------------------------------------------------------------

export async function start(options = {}) {
  try {
    const { vmName } = resolveContext(options);

    const status = limaStatus(vmName);

    if (status === null) {
      console.error(`Error: Sandbox '${vmName}' does not exist.`);
      console.error('Run `pi-sandbox create` first.');
      process.exit(1);
    }

    if (status === 'Running') {
      console.log(`Sandbox '${vmName}' is already running.`);
      return;
    }

    console.log(`Starting sandbox '${vmName}'...`);
    limaResume(vmName);
    console.log(`Sandbox '${vmName}' is running.`);

  } catch (err) {
    handleError(err);
  }
}
