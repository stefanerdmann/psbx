import { mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveContext, handleError } from './helpers.js';
import { limaStatus, limaStart } from '../lima.js';
import { writeLimaYaml } from '../template.js';

// ---------------------------------------------------------------------------
// pi-sandbox create
//
// Creates a new Lima VM for the current project directory.
// Full flow:
//   1. Resolve config + profile + VM name
//   2. Check for VM name collision
//   3. Create host session directory
//   4. Generate Lima YAML from config
//   5. Provision VM via limactl
//   6. Clean up temp YAML
//
// The session directory is created on the host BEFORE VM provisioning so
// the mount point exists when the VM starts. Sessions are stored in the
// project directory (<projectDir>/.pi-sandbox/sessions/) so they survive
// VM deletion.
// ---------------------------------------------------------------------------

export async function create() {
  try {
    const { profile, vmName, projectDir } = resolveContext();

    // Check for collision — VM names derive from directory basename,
    // so two projects named "app" would collide (Pitfall #10).
    const existing = limaStatus(vmName);
    if (existing !== null) {
      console.error(
        `Error: VM '${vmName}' already exists (status: ${existing}).`
      );
      console.error('Use `pi-sandbox recreate` to rebuild it.');
      process.exit(1);
    }

    // Create host session directory so the mount point exists
    const sessionDir = join(projectDir, '.pi-sandbox', 'sessions');
    mkdirSync(sessionDir, { recursive: true });

    // Generate Lima YAML from resolved profile
    const tmpPath = join(tmpdir(), `lima-${vmName}.yaml`);
    writeLimaYaml(profile, projectDir, tmpPath);

    console.log(`Creating sandbox: ${vmName}`);
    console.log(`  Profile: ${profile.cert ? 'corporate (with cert)' : 'default'}`);
    console.log(`  VM resources: ${profile.vm.cpus} CPUs, ${profile.vm.memory} RAM, ${profile.vm.disk} disk`);
    console.log(`  Project: ${projectDir}`);
    console.log('');

    try {
      // limactl start streams output to terminal (stdio: inherit)
      limaStart(vmName, tmpPath);
    } finally {
      // Always clean up temp YAML, even if provisioning fails
      try {
        unlinkSync(tmpPath);
      } catch {
        // Ignore cleanup errors
      }
    }

    console.log('');
    console.log(`Sandbox '${vmName}' is ready!`);
    console.log('Run `pi-sandbox enter` to start working.');

  } catch (err) {
    handleError(err);
  }
}
