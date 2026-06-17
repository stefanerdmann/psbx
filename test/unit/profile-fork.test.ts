import assert from 'node:assert/strict';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { exfiltrateConfigMounts } from '../../src/commands/profile-fork.ts';
import type { ConfigMount, SessionMount } from '../../src/types.ts';

// ---------------------------------------------------------------------------
// exfiltrateConfigMounts (migrated from static.test.js)
// ---------------------------------------------------------------------------

type CopyFn = (vmName: string, guestPath: string, hostDir: string) => void;

describe('exfiltrateConfigMounts', { concurrency: false }, () => {
  let tmpDir: string;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'psbx-exfiltrate-test-'));
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('handles scp backend (directory copied as subdirectory of staging parent)', () => {
    const profileDir = join(tmpDir, 'scp-profile');
    mkdirSync(join(profileDir, 'copilot'), { recursive: true });
    writeFileSync(join(profileDir, 'copilot', 'old.txt'), 'original');

    const mounts: ConfigMount[] = [
      {
        source: 'copilot',
        name: 'copilot',
        guestTarget: '~/.copilot',
      },
    ];

    function scpCopy(_vmName: string, guestPath: string, hostDir: string) {
      const subdir = join(hostDir, basename(guestPath));
      mkdirSync(subdir, { recursive: true });
      writeFileSync(join(subdir, 'marker.txt'), 'from-vm');
    }

    exfiltrateConfigMounts('test-vm', profileDir, mounts, [], scpCopy);

    const markerPath = join(profileDir, 'copilot', 'marker.txt');
    assert.ok(existsSync(markerPath), `marker.txt not found at ${markerPath}`);
    assert.strictEqual(readFileSync(markerPath, 'utf-8'), 'from-vm');
    assert.ok(!existsSync(join(profileDir, 'copilot', 'old.txt')), 'old file should be replaced');
  });

  it('handles rsync backend (contents copied directly into staging parent)', () => {
    const profileDir = join(tmpDir, 'rsync-profile');
    mkdirSync(join(profileDir, 'copilot'), { recursive: true });
    writeFileSync(join(profileDir, 'copilot', 'old.txt'), 'original');

    const mounts: ConfigMount[] = [
      {
        source: 'copilot',
        name: 'copilot',
        guestTarget: '~/.copilot',
      },
    ];

    function rsyncCopy(_vmName: string, _guestPath: string, hostDir: string) {
      writeFileSync(join(hostDir, 'marker.txt'), 'from-vm-rsync');
      mkdirSync(join(hostDir, 'subdir'), { recursive: true });
      writeFileSync(join(hostDir, 'subdir', 'nested.txt'), 'nested-content');
    }

    exfiltrateConfigMounts('test-vm', profileDir, mounts, [], rsyncCopy);

    const markerPath = join(profileDir, 'copilot', 'marker.txt');
    assert.ok(existsSync(markerPath), `marker.txt not found at ${markerPath}`);
    assert.strictEqual(readFileSync(markerPath, 'utf-8'), 'from-vm-rsync');
    assert.ok(existsSync(join(profileDir, 'copilot', 'subdir', 'nested.txt')));
    assert.ok(!existsSync(join(profileDir, 'copilot', 'old.txt')), 'old file should be replaced');
  });

  it('handles rsync backend with dot-prefixed guestTarget (the copilot-in-ubuntu case)', () => {
    const profileDir = join(tmpDir, 'rsync-dot-profile');
    mkdirSync(join(profileDir, 'copilot'), { recursive: true });

    const mounts: ConfigMount[] = [
      {
        source: 'copilot',
        name: 'copilot',
        guestTarget: '~/.copilot',
        exfiltrateExcludes: ['session-state', 'logs'],
      },
    ];

    function rsyncCopy(_vmName: string, _guestPath: string, hostDir: string) {
      writeFileSync(join(hostDir, 'settings.json'), '{"key":"value"}');
      mkdirSync(join(hostDir, 'session-state'), { recursive: true });
      writeFileSync(join(hostDir, 'session-state', 'state.db'), 'data');
      mkdirSync(join(hostDir, 'logs'), { recursive: true });
      writeFileSync(join(hostDir, 'logs', 'log.txt'), 'log');
    }

    exfiltrateConfigMounts('test-vm', profileDir, mounts, [], rsyncCopy);

    assert.ok(existsSync(join(profileDir, 'copilot', 'settings.json')));
    assert.ok(!existsSync(join(profileDir, 'copilot', 'session-state')));
    assert.ok(!existsSync(join(profileDir, 'copilot', 'logs')));
  });

  it('handles multi-segment source path (pi/agent case) with both backends', () => {
    const copyCases: Array<[label: string, copyFn: CopyFn]> = [
      [
        'scp',
        (_vm: string, guestPath: string, hostDir: string) => {
          const subdir = join(hostDir, basename(guestPath));
          mkdirSync(subdir, { recursive: true });
          writeFileSync(join(subdir, 'auth.json'), '{}');
        },
      ],
      [
        'rsync',
        (_vm: string, _guestPath: string, hostDir: string) => {
          writeFileSync(join(hostDir, 'auth.json'), '{}');
        },
      ],
    ];

    for (const [label, copyFn] of copyCases) {
      const profileDir = join(tmpDir, `multi-seg-${label}`);
      mkdirSync(join(profileDir, 'pi', 'agent'), { recursive: true });

      const mounts: ConfigMount[] = [
        {
          source: 'pi/agent',
          name: 'agent',
          guestTarget: '~/.pi/agent',
        },
      ];

      exfiltrateConfigMounts('test-vm', profileDir, mounts, [], copyFn);

      const authPath = join(profileDir, 'pi', 'agent', 'auth.json');
      assert.ok(existsSync(authPath), `[${label}] auth.json not found at ${authPath}`);
      assert.ok(
        !existsSync(join(profileDir, 'pi', 'agent', 'agent', 'auth.json')),
        `[${label}] agent config incorrectly nested`,
      );
    }
  });

  it('warns and creates empty target when copy fails', () => {
    const profileDir = join(tmpDir, 'fail-profile');
    mkdirSync(join(profileDir, 'copilot'), { recursive: true });

    const mounts: ConfigMount[] = [
      {
        source: 'copilot',
        name: 'copilot',
        guestTarget: '~/.copilot',
      },
    ];

    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args.join(' '));

    try {
      function failingCopy() {
        throw new Error('connection refused');
      }

      exfiltrateConfigMounts('test-vm', profileDir, mounts, [], failingCopy);

      assert.ok(warnings.length > 0, 'expected a warning');
      assert.ok(warnings[0].includes('connection refused'));
      assert.ok(existsSync(join(profileDir, 'copilot')), 'target dir should still exist');
    } finally {
      console.warn = origWarn;
    }
  });

  it('drops guest sessions[].guestSymlink links so they never land in the profile', () => {
    // Regression for the `psbx profile fork` ENOENT: the finalizer plants
    // `~/.pi/agent/sessions -> <guest-workdir>/.agents/pi-sessions` inside the
    // configMount target. That guest-only link must not be exfiltrated, else
    // the forked profile carries a dangling symlink that later breaks the
    // rebase hash walk (hashFinalizerConfig follows symlinks).
    const profileDir = join(tmpDir, 'session-symlink-profile');
    mkdirSync(join(profileDir, 'pi', 'agent'), { recursive: true });

    const mounts: ConfigMount[] = [
      { source: 'pi/agent', name: 'agent', guestTarget: '~/.pi/agent' },
    ];
    const sessions: SessionMount[] = [
      { workspacePath: '.agents/pi-sessions/', guestSymlink: '~/.pi/agent/sessions' },
    ];

    function rsyncCopy(_vm: string, _guestPath: string, hostDir: string) {
      writeFileSync(join(hostDir, 'settings.json'), '{}');
      // The guest link arrives as a dangling symlink to a guest-only path.
      symlinkSync('/home/agent/workdir/.agents/pi-sessions', join(hostDir, 'sessions'));
    }

    exfiltrateConfigMounts('test-vm', profileDir, mounts, sessions, rsyncCopy);

    assert.ok(existsSync(join(profileDir, 'pi', 'agent', 'settings.json')));
    let linkPresent = true;
    try {
      lstatSync(join(profileDir, 'pi', 'agent', 'sessions'));
    } catch {
      linkPresent = false;
    }
    assert.ok(!linkPresent, 'guest session symlink should be excluded from the profile');
  });
});
