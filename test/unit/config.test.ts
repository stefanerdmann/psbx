import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { describe, it } from 'node:test';
import { deepMerge, expandHome, getVmName, validateEnv } from '../../src/config.ts';
import type { EnvConfig } from '../../src/types.ts';

// ---------------------------------------------------------------------------
// deepMerge
// ---------------------------------------------------------------------------

describe('deepMerge', { concurrency: true }, () => {
  it('merges flat objects', () => {
    assert.deepStrictEqual(deepMerge({ a: 1 }, { b: 2 }), { a: 1, b: 2 });
  });

  it('overwrites scalar values', () => {
    assert.deepStrictEqual(deepMerge({ a: 1 }, { a: 2 }), { a: 2 });
  });

  it('deep-merges nested objects', () => {
    const result = deepMerge({ a: { x: 1, y: 2 } }, { a: { y: 3, z: 4 } });
    assert.deepStrictEqual(result, { a: { x: 1, y: 3, z: 4 } });
  });

  it('overwrites array with array (no concat)', () => {
    assert.deepStrictEqual(deepMerge({ a: [1] }, { a: [2, 3] }), { a: [2, 3] });
  });

  it('handles null source gracefully', () => {
    assert.deepStrictEqual(deepMerge({ a: 1 }, null), { a: 1 });
  });

  it('handles undefined source gracefully', () => {
    assert.deepStrictEqual(deepMerge({ a: 1 }, undefined), { a: 1 });
  });

  it('does not mutate the target', () => {
    const target: { a: { b: number; c?: number } } = { a: { b: 1 } };
    const result = deepMerge(target, { a: { c: 2 } });
    assert.strictEqual(target.a.c, undefined);
    assert.strictEqual(result.a.c, 2);
  });
});

// ---------------------------------------------------------------------------
// expandHome
// ---------------------------------------------------------------------------

describe('expandHome', { concurrency: true }, () => {
  it('expands bare ~', () => {
    assert.strictEqual(expandHome('~'), homedir());
  });

  it('expands ~/path', () => {
    assert.strictEqual(expandHome('~/foo'), `${homedir()}/foo`);
  });

  it('returns absolute paths unchanged', () => {
    assert.strictEqual(expandHome('/usr/bin'), '/usr/bin');
  });

  it('returns relative paths unchanged', () => {
    assert.strictEqual(expandHome('relative/path'), 'relative/path');
  });

  it('returns non-string values unchanged', () => {
    assert.strictEqual(expandHome(undefined), undefined);
    assert.strictEqual(expandHome(null), null);
    assert.strictEqual(expandHome(42), 42);
  });
});

// ---------------------------------------------------------------------------
// getVmName
// ---------------------------------------------------------------------------

describe('getVmName', { concurrency: true }, () => {
  it('sanitizes a directory name to a VM name', () => {
    const name = getVmName('/some/path/My-Project_123');
    assert.strictEqual(name, 'my-project-123');
  });

  it('strips leading and trailing hyphens', () => {
    const name = getVmName('/path/---test---');
    assert.strictEqual(name, 'test');
  });

  it('collapses consecutive non-alphanumeric chars', () => {
    const name = getVmName('/path/a___b...c');
    assert.strictEqual(name, 'a-b-c');
  });

  it('throws when directory name has no alphanumeric characters', () => {
    assert.throws(() => getVmName('/path/---'), /Cannot derive VM name/);
  });
});

// ---------------------------------------------------------------------------
// validateEnv (migrated from static.test.js + new cases)
// ---------------------------------------------------------------------------

describe('validateEnv', { concurrency: true }, () => {
  it('accepts a valid env object', () => {
    const result: EnvConfig = validateEnv(
      {
        defaultCmd: 'pi',
        shellEnvAllowlist: ['FOO'],
        configMounts: [{ source: 'pi/agent', name: 'agent', guestTarget: '~/.pi/agent' }],
      },
      'env',
    );
    assert.strictEqual(result.defaultCmd, 'pi');
    assert.deepStrictEqual(result.shellEnvAllowlist, ['FOO']);
    assert.strictEqual(result.configMounts.length, 1);
  });

  it('rejects non-object input', () => {
    assert.throws(() => validateEnv('string', 'env'), /must contain a mapping/);
    assert.throws(() => validateEnv(null, 'env'), /must contain a mapping/);
    assert.throws(() => validateEnv([1], 'env'), /must contain a mapping/);
  });

  it('rejects empty defaultCmd', () => {
    assert.throws(
      () =>
        validateEnv(
          {
            defaultCmd: '',
            configMounts: [{ source: 'a', name: 'a', guestTarget: '/a' }],
          },
          'env',
        ),
      /non-empty string/,
    );
  });

  it('rejects missing configMounts', () => {
    assert.throws(() => validateEnv({}, 'env'), /configMounts must be a non-empty array/);
  });

  it('rejects duplicate configMount names', () => {
    assert.throws(
      () =>
        validateEnv(
          {
            configMounts: [
              { source: 'a', name: 'dup', guestTarget: '/a' },
              { source: 'b', name: 'dup', guestTarget: '/b' },
            ],
          },
          'env',
        ),
      /duplicate/,
    );
  });

  it('rejects config mount paths that escape profile root', () => {
    assert.throws(
      () =>
        validateEnv(
          {
            configMounts: [{ source: '../agent', name: 'agent', guestTarget: '~/.pi/agent' }],
          },
          'env',
        ),
      /relative path/,
    );
  });

  it('rejects sessions.workspacePath that escapes project root', () => {
    assert.throws(
      () =>
        validateEnv(
          {
            configMounts: [
              {
                source: 'pi/agent',
                name: 'agent',
                guestTarget: '~/.pi/agent',
              },
            ],
            sessions: [{ workspacePath: '../sessions' }],
          },
          'env',
        ),
      /relative path/,
    );
  });

  it('rejects exfiltrate excludes that escape profile config mounts', () => {
    assert.throws(
      () =>
        validateEnv(
          {
            configMounts: [
              {
                source: 'pi/agent',
                name: 'agent',
                guestTarget: '~/.pi/agent',
                exfiltrateExcludes: ['../outside'],
              },
            ],
          },
          'env',
        ),
      /relative path/,
    );
  });

  it('accepts valid driftDetectionExcludes', () => {
    const result = validateEnv(
      {
        configMounts: [
          {
            source: 'pi/agent',
            name: 'agent',
            guestTarget: '~/.pi/agent',
            driftDetectionExcludes: ['npm/node_modules', 'cache'],
          },
        ],
      },
      'env',
    );
    assert.deepStrictEqual(result.configMounts[0].driftDetectionExcludes, [
      'npm/node_modules',
      'cache',
    ]);
  });

  it('rejects driftDetectionExcludes that escape mount', () => {
    assert.throws(
      () =>
        validateEnv(
          {
            configMounts: [
              {
                source: 'pi/agent',
                name: 'agent',
                guestTarget: '~/.pi/agent',
                driftDetectionExcludes: ['../outside'],
              },
            ],
          },
          'env',
        ),
      /relative path/,
    );
  });

  it('rejects non-array driftDetectionExcludes', () => {
    assert.throws(
      () =>
        validateEnv(
          {
            configMounts: [
              {
                source: 'pi/agent',
                name: 'agent',
                guestTarget: '~/.pi/agent',
                driftDetectionExcludes: 'not-an-array',
              },
            ],
          },
          'env',
        ),
      /driftDetectionExcludes must be an array/,
    );
  });

  it('filters non-string entries from shellEnvAllowlist', () => {
    const result: EnvConfig = validateEnv(
      {
        shellEnvAllowlist: ['FOO', 42, '', 'BAR'],
        configMounts: [{ source: 'a', name: 'a', guestTarget: '/a' }],
      },
      'env',
    );
    assert.deepStrictEqual(result.shellEnvAllowlist, ['FOO', 'BAR']);
  });

  it('allows undefined defaultCmd', () => {
    const result = validateEnv(
      {
        configMounts: [{ source: 'a', name: 'a', guestTarget: '/a' }],
      },
      'env',
    );
    assert.strictEqual(result.defaultCmd, undefined);
  });

  it('defaults sessions to empty array when omitted', () => {
    const result = validateEnv(
      {
        configMounts: [{ source: 'a', name: 'a', guestTarget: '/a' }],
      },
      'env',
    );
    assert.deepStrictEqual(result.sessions, []);
  });

  it('parses valid sessions array', () => {
    const result = validateEnv(
      {
        configMounts: [{ source: 'a', name: 'a', guestTarget: '/a' }],
        sessions: [
          { workspacePath: '.agents/sessions/', guestSymlink: '~/.pi/agent/sessions/' },
          { workspacePath: '.agents/db' },
        ],
      },
      'env',
    );
    assert.strictEqual(result.sessions.length, 2);
    assert.strictEqual(result.sessions[0].workspacePath, '.agents/sessions/');
    assert.strictEqual(result.sessions[0].guestSymlink, '~/.pi/agent/sessions/');
    assert.strictEqual(result.sessions[1].workspacePath, '.agents/db');
    assert.strictEqual(result.sessions[1].guestSymlink, undefined);
  });

  it('rejects non-array sessions', () => {
    assert.throws(
      () =>
        validateEnv(
          {
            configMounts: [{ source: 'a', name: 'a', guestTarget: '/a' }],
            sessions: 'not-an-array',
          },
          'env',
        ),
      /sessions must be an array/,
    );
  });

  it('rejects sessions entry with empty workspacePath', () => {
    assert.throws(
      () =>
        validateEnv(
          {
            configMounts: [{ source: 'a', name: 'a', guestTarget: '/a' }],
            sessions: [{ workspacePath: '' }],
          },
          'env',
        ),
      /workspacePath must be a non-empty string/,
    );
  });

  it('rejects sessions entry with empty guestSymlink', () => {
    assert.throws(
      () =>
        validateEnv(
          {
            configMounts: [{ source: 'a', name: 'a', guestTarget: '/a' }],
            sessions: [{ workspacePath: '.agents/sessions/', guestSymlink: '' }],
          },
          'env',
        ),
      /guestSymlink must be a non-empty string/,
    );
  });

  it('defaults shadowPaths to empty array when omitted', () => {
    const result = validateEnv(
      {
        configMounts: [{ source: 'a', name: 'a', guestTarget: '/a' }],
      },
      'env',
    );
    assert.deepStrictEqual(result.shadowPaths, []);
  });

  it('parses valid shadowPaths', () => {
    const result = validateEnv(
      {
        configMounts: [{ source: 'a', name: 'a', guestTarget: '/a' }],
        shadowPaths: ['node_modules', '.venv'],
      },
      'env',
    );
    assert.deepStrictEqual(result.shadowPaths, ['node_modules', '.venv']);
  });

  it('rejects absolute shadowPaths', () => {
    assert.throws(
      () =>
        validateEnv(
          {
            configMounts: [{ source: 'a', name: 'a', guestTarget: '/a' }],
            shadowPaths: ['/usr/lib'],
          },
          'env',
        ),
      /relative path/,
    );
  });

  it('rejects shadowPaths with ..', () => {
    assert.throws(
      () =>
        validateEnv(
          {
            configMounts: [{ source: 'a', name: 'a', guestTarget: '/a' }],
            shadowPaths: ['../outside'],
          },
          'env',
        ),
      /relative path/,
    );
  });

  it('rejects non-string shadowPaths entry', () => {
    assert.throws(
      () =>
        validateEnv(
          {
            configMounts: [{ source: 'a', name: 'a', guestTarget: '/a' }],
            shadowPaths: [42],
          },
          'env',
        ),
      /non-empty string/,
    );
  });

  it('rejects duplicate shadowPaths', () => {
    assert.throws(
      () =>
        validateEnv(
          {
            configMounts: [{ source: 'a', name: 'a', guestTarget: '/a' }],
            shadowPaths: ['node_modules', 'node_modules'],
          },
          'env',
        ),
      /duplicate/,
    );
  });

  it('rejects non-array shadowPaths', () => {
    assert.throws(
      () =>
        validateEnv(
          {
            configMounts: [{ source: 'a', name: 'a', guestTarget: '/a' }],
            shadowPaths: 'node_modules',
          },
          'env',
        ),
      /shadowPaths must be an array/,
    );
  });
});
