// ---------------------------------------------------------------------------
// psbx lifecycle tests
//
// Full end-to-end tests that exercise the CLI against a real Lima VM using the
// lightweight `self-test` profile. These are slow (VM provisioning takes
// minutes) and require Lima + a hypervisor to be installed on the host.
//
// Steps executed in order (sequential — each depends on the previous):
//
//  before()      – create tmpHome + projectDir, run `profile init self-test`
//   1. create    – `up --only-create --profile self-test`; assert VM is ready
//   2. status    – `status` reports "Running" after create
//   3. list      – `list` shows the VM name in output
//   4. SSH       – retry `limactl shell … true` until SSH is live (≤ 2 min)
//   5. shell     – `limactl shell` runs `echo smoke-test-ok` inside the VM
//   6. up+shell  – `up --shell` writes a marker file via stdin; verify on host
//   7. logs      – `logs` returns non-empty cloud-init output
//   8. stop      – `stop` halts the VM; stdout contains "has been stopped"
//   9. status    – `status` reports "Stopped"
//  10. start     – `up --only-start` resumes; stdout contains "is running"
//  11. status    – `status` reports "Running" again
//  12. recreate  – `up --only-recreate` deletes + reprovisions; "is ready!"
//  13. fork      – `profile fork copied-from-vm`: plant a marker inside the
//                  guest, fork the profile, verify marker exfiltrated correctly
//  14. delete    – `delete` removes the VM; "has been deleted"
//  15. status    – `status` reports "Not created"
//  16. up (full) – `up --shell --profile copied-from-vm`: creates, starts, and
//                  enters in one step; verifies exfiltrated agent config in guest
//  17. delete    – final cleanup `delete`
//  after()       – limactl stop/delete any remaining VMs, rm tmpHome + projectDir
// ---------------------------------------------------------------------------

import assert from 'node:assert/strict';
import type { SpawnSyncReturns } from 'node:child_process';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import type { LimaInstance } from '../src/types.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BIN = resolve(__dirname, '..', 'bin', 'psbx.ts');

// /tmp is a small tmpfs; use /var/tmp (main disk) so Lima has room for images.
// Reuse the real user's Lima download cache to avoid re-fetching on every run.
const SMOKE_TMPDIR = '/var/tmp';
const REAL_CACHE = join(process.env.HOME, '.cache');

type RunOptions = {
  HOME?: string;
  cwd?: string;
  input?: string;
  timeout?: number;
  env?: Record<string, string>;
};

function run(
  args: string[],
  { HOME, cwd, input, timeout = 15_000 }: RunOptions = {},
): SpawnSyncReturns<string> {
  const env = HOME ? { ...process.env, HOME, XDG_CACHE_HOME: REAL_CACHE } : process.env;
  return spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf-8',
    env,
    cwd: cwd ?? process.cwd(),
    ...(input !== undefined ? { input } : {}),
    timeout,
  });
}

function vmNameFrom(dir: string) {
  return basename(dir)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function limaCleanup(vmName: string) {
  spawnSync('limactl', ['stop', '--force', vmName], { encoding: 'utf-8', timeout: 60_000 });
  spawnSync('limactl', ['delete', '--force', vmName], { encoding: 'utf-8', timeout: 60_000 });
}

describe('lifecycle', {
  concurrency: false,
  timeout: 60 * 60 * 1000,
}, () => {
  let tmpHome: string;
  let projectDir: string;
  let vmName: string;

  before(() => {
    tmpHome = mkdtempSync(join(SMOKE_TMPDIR, 'psbx-smoke-home-'));
    projectDir = mkdtempSync(join(SMOKE_TMPDIR, 'psbx-smoke-proj-'));
    vmName = vmNameFrom(projectDir);
    const initResult = run(['profile', 'init', 'self-test', '--self-test'], {
      HOME: tmpHome,
      cwd: projectDir,
    });
    assert.strictEqual(initResult.status, 0, `stderr: ${initResult.stderr}`);
  });

  after(() => {
    // Clean up the project VM
    limaCleanup(vmName);
    // Clean up any cache VMs created under the test home (e.g. psbx-cache-*)
    const listResult = spawnSync('limactl', ['list', '--format', 'json'], {
      encoding: 'utf-8',
      env: { ...process.env, HOME: tmpHome },
      timeout: 15_000,
    });
    if (listResult.status === 0) {
      try {
        const instances = JSON.parse(listResult.stdout || '[]') as LimaInstance[];
        for (const inst of instances) {
          if (inst.name && inst.name !== vmName) {
            limaCleanup(inst.name);
          }
        }
      } catch {}
    }
    rmSync(tmpHome, { recursive: true, force: true });
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('[lifecycle] create provisions a new VM with the self-test profile', {
    timeout: 25 * 60 * 1000,
  }, () => {
    const r = run(['up', '--only-create', '--profile', 'self-test'], {
      HOME: tmpHome,
      cwd: projectDir,
      timeout: 25 * 60 * 1000,
    });
    assert.strictEqual(r.status, 0, `stderr:\n${r.stderr}\nstdout:\n${r.stdout}`);
    assert.ok(r.stdout.includes('is ready!'), `stdout: ${r.stdout}`);
  });

  it('[lifecycle] status reports Running after create', () => {
    const r = run(['status'], { HOME: tmpHome, cwd: projectDir });
    assert.strictEqual(r.status, 0);
    assert.ok(r.stdout.includes('Running'), `stdout: ${r.stdout}`);
  });

  it('[lifecycle] list shows the running VM', () => {
    const r = run(['list'], { HOME: tmpHome, cwd: projectDir });
    assert.strictEqual(r.status, 0);
    assert.ok(r.stdout.includes(vmName), `stdout: ${r.stdout}`);
  });

  // Without hardware virtualisation the SSH ControlMaster can time out during
  // the long provisioning run. Re-establish it before SSH-dependent tests by
  // retrying until the guest accepts connections.
  it('[lifecycle] SSH connectivity is established', { timeout: 3 * 60 * 1000 }, async () => {
    const deadline = Date.now() + 2 * 60_000;
    let lastErr = '';
    while (Date.now() < deadline) {
      const r = spawnSync('limactl', ['shell', vmName, '--', '/bin/sh', '-c', 'true'], {
        encoding: 'utf-8',
        timeout: 15_000,
        env: { ...process.env, HOME: tmpHome },
      });
      if (r.status === 0) return;
      lastErr = r.stderr;
      await new Promise<void>((resolve) => setTimeout(resolve, 5_000));
    }
    assert.fail(`SSH not available within 2 minutes. Last error: ${lastErr}`);
  });

  it('[lifecycle] runs a command inside the VM via limactl shell directly', {
    timeout: 30_000,
  }, () => {
    const r = spawnSync('limactl', ['shell', vmName, '--', '/bin/sh', '-c', 'echo smoke-test-ok'], {
      encoding: 'utf-8',
      timeout: 30_000,
      env: { ...process.env, HOME: tmpHome },
    });
    assert.strictEqual(r.status, 0, `stderr: ${r.stderr}`);
    assert.ok(r.stdout.includes('smoke-test-ok'), `stdout: ${r.stdout}`);
  });

  // limactl shell (interactive, no explicit command) exits 0 without captured
  // output when stdin is not a tty. Verify the shell ran inside the VM by
  // writing a marker file into the shared workdir and checking it on the host.
  it('[lifecycle] up --shell runs a command inside the VM and exits cleanly', {
    timeout: 30_000,
  }, () => {
    const markerFile = join(projectDir, 'smoke-enter.txt');
    rmSync(markerFile, { force: true });
    const r = run(['up', '--shell'], {
      HOME: tmpHome,
      cwd: projectDir,
      input: 'echo smoke-enter-ok > /home/agent/workdir/smoke-enter.txt\nexit\n',
      timeout: 30_000,
    });
    assert.strictEqual(r.status, 0, `stderr: ${r.stderr}`);
    assert.ok(
      existsSync(markerFile),
      `marker file not created at ${markerFile}; stderr: ${r.stderr}`,
    );
  });

  it('[lifecycle] logs outputs the cloud-init provisioning log', { timeout: 30_000 }, () => {
    const r = run(['logs'], { HOME: tmpHome, cwd: projectDir, timeout: 30_000 });
    assert.strictEqual(r.status, 0, `stderr: ${r.stderr}`);
    assert.ok(r.stdout.length > 0, 'expected non-empty log output');
  });

  it('[lifecycle] stop halts the running VM', { timeout: 10 * 60 * 1000 }, () => {
    const r = run(['stop'], { HOME: tmpHome, cwd: projectDir, timeout: 10 * 60 * 1000 });
    assert.strictEqual(r.status, 0, `stderr: ${r.stderr}`);
    assert.ok(r.stdout.includes('has been stopped'), `stdout: ${r.stdout}`);
  });

  it('[lifecycle] status reports Stopped after stop', () => {
    const r = run(['status'], { HOME: tmpHome, cwd: projectDir });
    assert.strictEqual(r.status, 0);
    assert.ok(r.stdout.includes('Stopped'), `stdout: ${r.stdout}`);
  });

  it('[lifecycle] start resumes the stopped VM', { timeout: 5 * 60 * 1000 }, () => {
    const r = run(['up', '--only-start', '--profile', 'self-test'], {
      HOME: tmpHome,
      cwd: projectDir,
      timeout: 5 * 60 * 1000,
    });
    assert.strictEqual(r.status, 0, `stderr: ${r.stderr}`);
    assert.ok(r.stdout.includes('is running'), `stdout: ${r.stdout}`);
  });

  it('[lifecycle] status reports Running after start', () => {
    const r = run(['status'], { HOME: tmpHome, cwd: projectDir });
    assert.strictEqual(r.status, 0);
    assert.ok(r.stdout.includes('Running'), `stdout: ${r.stdout}`);
  });

  it('[lifecycle] recreate deletes and reprovisions the VM', { timeout: 30 * 60 * 1000 }, () => {
    const r = run(['-y', 'up', '--only-recreate', '--profile', 'self-test'], {
      HOME: tmpHome,
      cwd: projectDir,
      timeout: 30 * 60 * 1000,
    });
    assert.strictEqual(r.status, 0, `stderr:\n${r.stderr}\nstdout:\n${r.stdout}`);
    assert.ok(r.stdout.includes('is ready!'), `stdout: ${r.stdout}`);
  });

  it('[lifecycle] profile fork copies the VM profile and exfiltrated agent config', {
    timeout: 60_000,
  }, () => {
    // Plant a marker file inside the VM's ~/.pi/agent to verify exfiltration
    const plant = spawnSync(
      'limactl',
      [
        'shell',
        vmName,
        '--',
        '/bin/sh',
        '-c',
        'echo from-vm-marker > /home/agent/.pi/agent/marker.txt',
      ],
      { encoding: 'utf-8', timeout: 30_000, env: { ...process.env, HOME: tmpHome } },
    );
    assert.strictEqual(plant.status, 0, `failed to plant marker: ${plant.stderr}`);

    const r = run(['profile', 'fork', 'copied-from-vm'], {
      HOME: tmpHome,
      cwd: projectDir,
      timeout: 60_000,
    });
    assert.strictEqual(r.status, 0, `stderr: ${r.stderr}\nstdout: ${r.stdout}`);
    assert.ok(
      r.stdout.includes("Profile 'copied-from-vm'") || r.stdout.includes('copied-from-vm'),
      `stdout: ${r.stdout}`,
    );

    // Exfiltration must succeed without warnings regardless of whether Lima
    // used rsync (copies contents directly) or scp (copies as subdirectory).
    assert.ok(
      !r.stdout.includes('Warning: Could not copy'),
      `fork emitted unexpected copy warning: ${r.stdout}`,
    );

    // Verify marker was exfiltrated to the new profile's source dir
    const profileDir = join(tmpHome, '.psbx', 'profiles', 'copied-from-vm');
    const markerPath = join(profileDir, 'pi', 'agent', 'marker.txt');
    const badPath = join(profileDir, 'pi', 'agent', 'agent', 'marker.txt');
    assert.ok(existsSync(markerPath), `marker.txt not found at ${markerPath}`);
    assert.ok(!existsSync(badPath), `agent config incorrectly nested at ${badPath}`);
    assert.strictEqual(readFileSync(markerPath, 'utf-8').trim(), 'from-vm-marker');
  });

  it('[lifecycle] delete removes the VM', { timeout: 10 * 60 * 1000 }, () => {
    const r = run(['delete'], {
      HOME: tmpHome,
      cwd: projectDir,
      input: 'y\n',
      timeout: 10 * 60 * 1000,
    });
    assert.strictEqual(r.status, 0, `stderr: ${r.stderr}`);
    assert.ok(r.stdout.includes('has been deleted'), `stdout: ${r.stdout}`);
  });

  it('[lifecycle] status reports Not created after delete', () => {
    const r = run(['status'], { HOME: tmpHome, cwd: projectDir });
    assert.strictEqual(r.status, 0);
    assert.ok(r.stdout.includes('Not created'), `stdout: ${r.stdout}`);
  });

  it('[lifecycle] up creates, starts, and enters the VM in one step', {
    timeout: 30 * 60 * 1000,
  }, () => {
    // The VM was rebased to 'copied-from-vm' by profile fork above. Verify that
    // up --shell uses that profile end-to-end and the exfiltrated agent config
    // (marker.txt) is present inside the guest.
    const markerFile = join(projectDir, 'smoke-up.txt');
    rmSync(markerFile, { force: true });
    const r = run(['up', '--shell', '--profile', 'copied-from-vm'], {
      HOME: tmpHome,
      cwd: projectDir,
      input: 'cat /home/agent/.pi/agent/marker.txt > /home/agent/workdir/smoke-up.txt\nexit\n',
      timeout: 30 * 60 * 1000,
    });
    assert.strictEqual(r.status, 0, `stderr:\n${r.stderr}\nstdout:\n${r.stdout}`);
    assert.ok(
      existsSync(markerFile),
      `marker file not created at ${markerFile}; stderr: ${r.stderr}`,
    );
    // Verify the agent config from the forked profile was provisioned into the VM
    assert.strictEqual(readFileSync(markerFile, 'utf-8').trim(), 'from-vm-marker');
  });

  it('[lifecycle] delete removes the VM after full up test', { timeout: 10 * 60 * 1000 }, () => {
    const r = run(['delete'], {
      HOME: tmpHome,
      cwd: projectDir,
      input: 'y\n',
      timeout: 10 * 60 * 1000,
    });
    assert.strictEqual(r.status, 0, `stderr: ${r.stderr}`);
    assert.ok(r.stdout.includes('has been deleted'), `stdout: ${r.stdout}`);
  });
});
