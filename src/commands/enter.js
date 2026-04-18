import { resolveContext, handleError } from './helpers.js';
import { limaStatus, limaResume, limaShell } from '../lima.js';

// ---------------------------------------------------------------------------
// pi-sandbox enter
//
// Opens an interactive shell inside the project's VM.
//
// Auto-start behavior: if the VM exists but is stopped, it's automatically
// resumed before entering. This matches the prototype's UX — users don't
// need to manually start VMs before entering them.
//
// Environment passthrough: MCP bearer tokens (and any other env vars listed
// in the config's mcp.envPassthrough) are forwarded to the guest via
// LIMA_SHELLENV_ALLOW. All other host env vars are blocked to prevent
// leakage (Pitfall #9).
// ---------------------------------------------------------------------------

export async function enter(options = {}) {
  try {
    const { profile, vmName } = resolveContext(options);

    const status = limaStatus(vmName);

    if (status === null) {
      console.error(`Error: Sandbox '${vmName}' does not exist.`);
      console.error('Run `pi-sandbox create` first.');
      process.exit(1);
    }

    // Auto-start stopped VMs — user shouldn't have to think about VM state
    if (status !== 'Running') {
      console.log(`Sandbox '${vmName}' is ${status.toLowerCase()}. Starting...`);
      limaResume(vmName);
    }

    // Drop into the shell. This blocks until the user exits.
    // Minimal output here — enter should feel instant when VM is running.
    limaShell(vmName, {
      envPassthrough: profile.mcp.envPassthrough
    });

  } catch (err) {
    handleError(err);
  }
}
