import { execFileSync, spawnSync } from 'node:child_process';

// ---------------------------------------------------------------------------
// Custom error class for Lima-related failures.
// Provides typed error handling so callers can distinguish Lima errors
// from other failures.
// ---------------------------------------------------------------------------

export class LimaError extends Error {
  constructor(message, { command, exitCode, stderr } = {}) {
    super(message);
    this.name = 'LimaError';
    this.command = command;
    this.exitCode = exitCode;
    this.stderr = stderr;
  }
}

// ---------------------------------------------------------------------------
// Internal helper: run a limactl command.
//
// mode: 'inherit' — stream stdout/stderr to terminal (for interactive commands)
//       'capture' — capture stdout/stderr and return them
// ---------------------------------------------------------------------------

function runLimactl(args, { mode = 'inherit', env } = {}) {
  const command = `limactl ${args.join(' ')}`;
  const options = {
    encoding: 'utf-8',
    env: env ? { ...process.env, ...env } : undefined
  };

  if (mode === 'inherit') {
    options.stdio = 'inherit';
  }

  try {
    if (mode === 'inherit') {
      execFileSync('limactl', args, options);
      return null;
    } else {
      const result = spawnSync('limactl', args, options);
      if (result.error) {
        throw result.error;
      }
      if (result.status !== 0) {
        throw new LimaError(
          `limactl command failed: ${command}\n${result.stderr || ''}`.trim(),
          { command, exitCode: result.status, stderr: result.stderr }
        );
      }
      return result.stdout;
    }
  } catch (err) {
    if (err instanceof LimaError) throw err;

    // limactl not installed
    if (err.code === 'ENOENT') {
      throw new LimaError(
        'limactl not found. Install Lima first: https://lima-vm.io',
        { command }
      );
    }

    // Non-zero exit from execFileSync
    if (err.status !== undefined) {
      throw new LimaError(
        `limactl command failed: ${command}\n${err.stderr || err.message}`.trim(),
        { command, exitCode: err.status, stderr: err.stderr?.toString() }
      );
    }

    throw err;
  }
}

// ---------------------------------------------------------------------------
// Start a new VM from a YAML config file.
// Used by `create` command — provisions a fresh VM.
// --tty=false prevents interactive prompts during provisioning.
// ---------------------------------------------------------------------------

export function limaStart(name, yamlPath) {
  runLimactl(['start', '--tty=false', '--name', name, yamlPath]);
}

// ---------------------------------------------------------------------------
// Stop a running VM.
// ---------------------------------------------------------------------------

export function limaStop(name) {
  runLimactl(['stop', name]);
}

// ---------------------------------------------------------------------------
// Delete a VM. Must be stopped first.
// ---------------------------------------------------------------------------

export function limaDelete(name) {
  runLimactl(['delete', name]);
}

// ---------------------------------------------------------------------------
// Open an interactive shell inside the VM.
//
// --preserve-env forwards the host's environment (filtered by LIMA_SHELLENV).
// --workdir=/app sets the working directory to the mounted project dir.
//
// The env option sets LIMA_SHELLENV_BLOCK and LIMA_SHELLENV_ALLOW to control
// which host env vars reach the guest. This prevents env leakage (Pitfall #9)
// while allowing MCP tokens through.
// ---------------------------------------------------------------------------

export function limaShell(name, { envPassthrough = [] } = {}) {
  const env = {
    LIMA_SHELLENV_BLOCK: '*',
    LIMA_SHELLENV_ALLOW: envPassthrough.join(', ')
  };

  // Use spawnSync with stdio inherit for interactive shell
  const result = spawnSync('limactl', [
    'shell', '--preserve-env', '--workdir=/app', name
  ], {
    stdio: 'inherit',
    env: { ...process.env, ...env }
  });

  if (result.error) {
    if (result.error.code === 'ENOENT') {
      throw new LimaError(
        'limactl not found. Install Lima first: https://lima-vm.io',
        { command: 'limactl shell' }
      );
    }
    throw result.error;
  }
}

// ---------------------------------------------------------------------------
// Get the status of a VM by name.
// Returns the status string (e.g., "Running", "Stopped") or null if the VM
// does not exist.
// ---------------------------------------------------------------------------

export function limaStatus(name) {
  try {
    const output = runLimactl(
      ['ls', '-f', '{{.Status}}', name],
      { mode: 'capture' }
    );
    const status = output?.trim();
    return status || null;
  } catch (err) {
    // Re-throw if limactl itself is missing — that's not a "VM not found" case
    if (err instanceof LimaError && err.message.includes('not found. Install')) {
      throw err;
    }
    // Lima returns non-zero when the instance doesn't exist
    if (err instanceof LimaError) {
      return null;
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// List all Lima VMs as parsed JSON.
// Returns an array of VM objects.
// ---------------------------------------------------------------------------

export function limaList() {
  const output = runLimactl(['ls', '--json'], { mode: 'capture' });
  if (!output || !output.trim()) {
    return [];
  }

  // limactl ls --json outputs one JSON object per line (JSONL format)
  const vms = output
    .trim()
    .split('\n')
    .filter(line => line.trim())
    .map(line => JSON.parse(line));

  return vms;
}

// ---------------------------------------------------------------------------
// Retrieve provisioning logs from inside the VM.
// Reads cloud-init output log — useful for debugging failed creates.
// Returns the log content as a string.
// ---------------------------------------------------------------------------

export function limaLogs(name) {
  const output = runLimactl(
    ['shell', name, 'cat', '/var/log/cloud-init-output.log'],
    { mode: 'capture' }
  );
  return output || '';
}
