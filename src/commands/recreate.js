import { mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveContext, confirm, handleError } from './helpers.js';
import { limaStatus, limaStop, limaDelete, limaStart } from '../lima.js';
import { writeLimaYaml } from '../template.js';

// ---------------------------------------------------------------------------
// pi-sandbox recreate
//
// Tears down the existing VM and creates a fresh one from the current config.
// This is the way to apply config changes (Lima can't hot-reconfigure VMs).
//
// Session data survives because it lives in the project directory, not the VM.
// Auth tokens, MCP config, and settings are re-provisioned from the host.
// ---------------------------------------------------------------------------

export async function recreate() {
  try {
    const { profile, vmName, projectDir } = resolveContext();

    const status = limaStatus(vmName);

    if (status === null) {
      console.error(`Error: Sandbox '${vmName}' does not exist.`);
      console.error('Use `pi-sandbox create` instead.');
      process.exit(1);
    }

    const yes = await confirm(
      `This will delete and recreate sandbox '${vmName}'.\n` +
      'All VM state will be lost (sessions are preserved). Continue? [y/N] '
    );

    if (!yes) {
      console.log('Recreate canceled.');
      return;
    }

    // --- Teardown ---

    if (status === 'Running') {
      console.log(`Stopping sandbox '${vmName}'...`);
      limaStop(vmName);
    }

    console.log(`Deleting sandbox '${vmName}'...`);
    limaDelete(vmName);

    // --- Rebuild ---

    // Ensure session dir exists on host
    const sessionDir = join(projectDir, '.pi-sandbox', 'sessions');
    mkdirSync(sessionDir, { recursive: true });

    // Generate fresh Lima YAML from current config
    const tmpPath = join(tmpdir(), `lima-${vmName}.yaml`);
    writeLimaYaml(profile, projectDir, tmpPath);

    console.log('');
    console.log(`Recreating sandbox: ${vmName}`);
    console.log(`  Profile: ${profile.cert ? 'corporate (with cert)' : 'default'}`);
    console.log(`  VM resources: ${profile.vm.cpus} CPUs, ${profile.vm.memory} RAM, ${profile.vm.disk} disk`);
    console.log('');

    try {
      limaStart(vmName, tmpPath);
    } finally {
      try {
        unlinkSync(tmpPath);
      } catch {
        // Ignore cleanup errors
      }
    }

    console.log('');
    console.log(`Sandbox '${vmName}' has been recreated!`);
    console.log('Run `pi-sandbox enter` to start working.');

  } catch (err) {
    handleError(err);
  }
}
