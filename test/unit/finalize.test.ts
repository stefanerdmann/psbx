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
          projectSessionDir: '.agents/sessions',
          sessionSymlink: '~/.pi/agents/sessions',
        },
      ],
    });
    assert.ok(script.includes('/mnt/host-config/agent'));
    assert.ok(script.includes('/home/pi/workdir/.agents/sessions'));
    assert.ok(!script.includes('/tmp/psbx-cache-profile'));
    assert.ok(!script.includes('/Users/alice/project'));
  });

  it('creates session dirs for mounts with projectSessionDir', () => {
    const script = profileConfigFinalizerScript({
      configMounts: [
        {
          source: 'copilot',
          name: 'copilot',
          guestTarget: '~/.copilot',
          projectSessionDir: '.agents/copilot-sessions/session-state',
          sessionSymlink: '~/.copilot/session-state',
        },
      ],
    });
    assert.ok(script.includes('mkdir -p'));
    assert.ok(script.includes('.agents/copilot-sessions/session-state'));
  });

  it('handles empty configMounts', () => {
    const script = profileConfigFinalizerScript({ configMounts: [] });
    assert.ok(script.includes('set -eu'));
    assert.ok(script.includes('mountpoint'));
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
