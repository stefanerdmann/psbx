import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { cacheSysprepScript, profileConfigFinalizerScript } from '../../src/finalize.ts';
import { shellQuote } from '../../src/utils.ts';

// ---------------------------------------------------------------------------
// shellQuote
// ---------------------------------------------------------------------------

describe('shellQuote', { concurrency: true }, () => {
  it('wraps a simple string in single quotes', () => {
    assert.strictEqual(shellQuote('hello'), "'hello'");
  });

  it('escapes embedded single quotes', () => {
    assert.strictEqual(shellQuote("it's"), "'it'\"'\"'s'");
  });

  it('handles empty string', () => {
    assert.strictEqual(shellQuote(''), "''");
  });

  it('handles strings with spaces and special chars', () => {
    const result = shellQuote('hello world $HOME');
    assert.strictEqual(result, "'hello world $HOME'");
  });
});

// ---------------------------------------------------------------------------
// profileConfigFinalizerScript (migrated from static.test.js)
// ---------------------------------------------------------------------------

describe('profileConfigFinalizerScript', { concurrency: true }, () => {
  it('uses guest mounts and never embeds host profile/project paths', () => {
    const script: string = profileConfigFinalizerScript({
      configMounts: [
        {
          source: 'pi/agent',
          name: 'agent',
          guestTarget: '~/.pi/agent',
        },
      ],
      sessions: [{ workspacePath: '.agents/sessions', guestSymlink: '~/.pi/agents/sessions' }],
    });
    assert.ok(script.includes('/mnt/host-config/agent'));
    assert.ok(script.includes('/home/agent/workdir/.agents/sessions'));
    assert.ok(!script.includes('/tmp/psbx-cache-profile'));
    assert.ok(!script.includes('/Users/alice/project'));
  });

  it('creates session parent dir (mkdir of parent) when workspacePath is a file path (no trailing slash)', () => {
    const script = profileConfigFinalizerScript({
      configMounts: [
        {
          source: 'copilot',
          name: 'copilot',
          guestTarget: '~/.copilot',
        },
      ],
      sessions: [
        {
          workspacePath: '.agents/copilot-sessions/session-state',
          guestSymlink: '~/.copilot/session-state',
        },
      ],
    });
    // mkdir must target the parent directory, not the file path itself
    assert.ok(script.includes('mkdir -p'));
    assert.ok(
      script.includes(".agents/copilot-sessions'"),
      `expected parent dir in mkdir; script:\n${script}`,
    );
    assert.ok(
      !script.match(/mkdir -p '[^']*\.agents\/copilot-sessions\/session-state'/),
      `must NOT mkdir the file path itself; script:\n${script}`,
    );
    // symlink target still points to the full workspacePath path
    assert.ok(
      script.includes('.agents/copilot-sessions/session-state'),
      `expected full file path in symlink target; script:\n${script}`,
    );
  });

  it('creates session dir directly when workspacePath is a directory path (trailing slash)', () => {
    const script = profileConfigFinalizerScript({
      configMounts: [
        {
          source: 'pi',
          name: 'pi',
          guestTarget: '~/.pi',
        },
      ],
      sessions: [
        {
          workspacePath: '.agents/pi-sessions/',
          guestSymlink: '~/.pi/agent/sessions/',
        },
      ],
    });
    assert.ok(script.includes('mkdir -p'));
    assert.ok(
      script.match(/mkdir -p '[^']*\.agents\/pi-sessions\//),
      `expected dir path in mkdir; script:\n${script}`,
    );
  });

  it('handles empty configMounts', () => {
    const script = profileConfigFinalizerScript({
      configMounts: [],
      sessions: [],
      shadowPaths: [],
    });
    assert.ok(script.includes('set -eu'));
    assert.ok(script.includes('mountpoint'));
  });

  it('emits no bind-mount lines when shadowPaths is empty', () => {
    const script = profileConfigFinalizerScript({
      configMounts: [],
      sessions: [],
      shadowPaths: [],
    });
    assert.ok(!script.includes('mount --bind'));
  });

  it('emits sudo mount --bind for each shadowPath', () => {
    const script = profileConfigFinalizerScript({
      configMounts: [],
      sessions: [],
      shadowPaths: ['node_modules'],
    });
    assert.ok(script.includes('sudo mkdir -p'));
    assert.ok(script.includes('/var/lib/psbx/shadows/node_modules'));
    assert.ok(script.includes('/home/agent/workdir/node_modules'));
    assert.ok(script.includes('sudo mount --bind'));
    assert.ok(script.includes('sudo chown $(id -u):$(id -g)'));
  });

  it('shell-quotes shadow paths', () => {
    const script = profileConfigFinalizerScript({
      configMounts: [],
      sessions: [],
      shadowPaths: ['my modules'],
    });
    assert.ok(script.includes(shellQuote('/var/lib/psbx/shadows/my modules')));
    assert.ok(script.includes(shellQuote('/home/agent/workdir/my modules')));
  });
});

// ---------------------------------------------------------------------------
// cacheSysprepScript (migrated from static.test.js)
// ---------------------------------------------------------------------------

describe('cacheSysprepScript', { concurrency: true }, () => {
  it('creates /usr/local/sbin before writing helper scripts', () => {
    const script: string = cacheSysprepScript();
    assert.ok(script.includes('mkdir -p /usr/local/sbin'));
    assert.ok(
      script.indexOf('mkdir -p /usr/local/sbin') <
        script.indexOf('cat >/usr/local/sbin/psbx-regenerate-ssh-host-keys'),
    );
  });

  it('removes SSH host keys and machine-id for clone identity reset', () => {
    const script = cacheSysprepScript();
    assert.ok(script.includes('rm -f /etc/ssh/ssh_host_*'));
    assert.ok(script.includes('machine-id'));
  });
});
