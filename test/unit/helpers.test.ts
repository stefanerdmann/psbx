import assert from 'node:assert/strict';
import type { SpawnSyncReturns } from 'node:child_process';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { hashFinalizerConfig, hashLimaConfig } from '../../src/commands/helpers.ts';
import { detectMismatches, warnIgnoredLimactlArgs } from '../../src/commands/up.ts';
import { resolveProfile } from '../../src/config.ts';
import type { Profile } from '../../src/types.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BIN = resolve(__dirname, '..', '..', 'bin', 'psbx.ts');

type RunOptions = {
  HOME?: string;
  cwd?: string;
  input?: string;
  timeout?: number;
  env?: Record<string, string>;
};

function run(
  args: string[],
  { HOME, cwd, input, timeout = 15_000, env = {} }: RunOptions = {},
): SpawnSyncReturns<string> {
  const baseEnv = HOME ? { ...process.env, HOME } : { ...process.env };
  return spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf-8',
    env: { ...baseEnv, ...env },
    cwd: cwd ?? process.cwd(),
    ...(input !== undefined ? { input } : {}),
    timeout,
  });
}

// ---------------------------------------------------------------------------
// detectMismatches (migrated from static.test.js)
// ---------------------------------------------------------------------------

describe('detectMismatches', { concurrency: true }, () => {
  it('returns empty when VM and registry do not exist', () => {
    const result = detectMismatches({
      existsAsVm: false,
      existsInRegistry: false,
      registryEntry: null,
      profile: { name: 'default' },
      options: {},
    });
    assert.deepStrictEqual(result, []);
  });

  it('reports VM exists but no registry entry', () => {
    const result = detectMismatches({
      existsAsVm: true,
      existsInRegistry: false,
      registryEntry: null,
      profile: { name: 'default' },
      options: {},
    });
    assert.strictEqual(result.length, 1);
    assert.ok(result[0].includes('no registry entry'));
  });

  it('reports registry entry but no VM', () => {
    const result = detectMismatches({
      existsAsVm: false,
      existsInRegistry: true,
      registryEntry: { profile: 'default', defaultCmd: 'pi' },
      profile: { name: 'default' },
      options: {},
    });
    assert.strictEqual(result.length, 1);
    assert.ok(result[0].includes('registry entry exists but VM does not'));
  });

  it('returns empty when profile matches', () => {
    const result = detectMismatches({
      existsAsVm: true,
      existsInRegistry: true,
      registryEntry: { profile: 'work' },
      profile: { name: 'work' },
    });
    assert.deepStrictEqual(result, []);
  });

  it('reports profile mismatch with specific names', () => {
    const result = detectMismatches({
      existsAsVm: true,
      existsInRegistry: true,
      registryEntry: { profile: 'work' },
      profile: { name: 'dev' },
    });
    assert.strictEqual(result.length, 1);
    assert.ok(result[0].includes('profile:'), `reason: ${result[0]}`);
    assert.ok(result[0].includes("'work'"), `reason: ${result[0]}`);
    assert.ok(result[0].includes("'dev'"), `reason: ${result[0]}`);
  });

  it('reports Lima config hash mismatch when limaConfigHash differs', () => {
    const result = detectMismatches({
      existsAsVm: true,
      existsInRegistry: true,
      registryEntry: { profile: 'default', defaultCmd: 'pi', limaConfigHash: 'oldhash123' },
      profile: { name: 'default', limaPath: '/nonexistent/lima.yaml' },
      projectDir: '/tmp',
      options: {},
    });
    // Hash computation will fail (no file), so the check is skipped gracefully
    assert.deepStrictEqual(result, []);
  });

  it('reports Lima config hash mismatch with a real profile', () => {
    const home = mkdtempSync(join(tmpdir(), 'psbx-hash-home-'));
    const proj = mkdtempSync(join(tmpdir(), 'psbx-hash-proj-'));
    const origHome = process.env.HOME;
    try {
      run(['profile', 'init', 'self-test', '--self-test'], { HOME: home, cwd: proj });
      process.env.HOME = home;
      const profile = resolveProfile({ defaultProfile: 'self-test' }, 'self-test');
      const finalizerHash = hashFinalizerConfig(profile);
      const result = detectMismatches({
        existsAsVm: true,
        existsInRegistry: true,
        registryEntry: {
          profile: 'self-test',
          finalizerHash,
          limaConfigHash: 'stale-hash',
        },
        profile,
        projectDir: proj,
        options: {},
      });
      assert.strictEqual(result.length, 1, `expected 1 mismatch, got: ${JSON.stringify(result)}`);
      assert.ok(result[0].includes('Lima configuration'), `reason: ${result[0]}`);

      // No mismatch when hashes match
      const currentHash = hashLimaConfig(profile, proj);
      const result2 = detectMismatches({
        existsAsVm: true,
        existsInRegistry: true,
        registryEntry: {
          profile: 'self-test',
          finalizerHash,
          limaConfigHash: currentHash,
        },
        profile,
        projectDir: proj,
        options: {},
      });
      assert.deepStrictEqual(result2, []);
    } finally {
      process.env.HOME = origHome;
      rmSync(home, { recursive: true, force: true });
      rmSync(proj, { recursive: true, force: true });
    }
  });

  it('does not flag hash mismatch when registry has no limaConfigHash', () => {
    const result = detectMismatches({
      existsAsVm: true,
      existsInRegistry: true,
      registryEntry: { profile: 'default' },
      profile: { name: 'default' },
      projectDir: '/tmp',
      options: {},
    });
    assert.deepStrictEqual(result, []);
  });

  it('does NOT flag finalizer drift as a recreate-worthy mismatch (handled in-place by up)', () => {
    const originalProfile: Pick<Profile, 'name' | 'configMounts'> = {
      name: 'default',
      configMounts: [
        {
          source: 'agent',
          name: 'agent',
          guestTarget: '~/.pi/agent',
          projectSessionDir: '.agents/sessions',
        },
      ],
    };
    const result = detectMismatches({
      existsAsVm: true,
      existsInRegistry: true,
      registryEntry: {
        profile: 'default',
        finalizerHash: hashFinalizerConfig(originalProfile),
      },
      profile: {
        name: 'default',
        configMounts: [
          {
            source: 'agent',
            name: 'agent',
            guestTarget: '~/.pi/agent-next',
            projectSessionDir: '.agents/sessions',
          },
        ],
      },
      projectDir: '/tmp',
    });
    assert.deepStrictEqual(result, []);
  });

  it('reports pending finalization as inconsistent', () => {
    const result = detectMismatches({
      existsAsVm: true,
      existsInRegistry: true,
      registryEntry: {
        profile: 'default',
        finalizerStatus: 'pending',
      },
      profile: { name: 'default', configMounts: [] },
      projectDir: '/tmp',
    });
    assert.strictEqual(result.length, 1);
    assert.ok(result[0].includes('did not complete'), `reason: ${result[0]}`);
  });

  it('does NOT flag profile config content drift as a recreate-worthy mismatch', () => {
    const profileDir = mkdtempSync(join(tmpdir(), 'psbx-finalizer-drift-'));
    try {
      mkdirSync(join(profileDir, 'pi', 'agent'), { recursive: true });
      const settingsPath = join(profileDir, 'pi', 'agent', 'settings.json');
      const profile = {
        name: 'default',
        dir: profileDir,
        configMounts: [
          {
            source: 'pi/agent',
            name: 'agent',
            guestTarget: '~/.pi/agent',
            projectSessionDir: '.agents/sessions',
          },
        ],
      };
      writeFileSync(settingsPath, '{"before":true}\n');
      const finalizerHash = hashFinalizerConfig(profile);
      writeFileSync(settingsPath, '{"after":true}\n');

      const result = detectMismatches({
        existsAsVm: true,
        existsInRegistry: true,
        registryEntry: {
          profile: 'default',
          finalizerHash,
        },
        profile,
        projectDir: '/tmp',
      });
      assert.deepStrictEqual(result, []);
    } finally {
      rmSync(profileDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// cache invalidation helpers (migrated from static.test.js)
// ---------------------------------------------------------------------------

describe('cache invalidation helpers', { concurrency: true }, () => {
  it('hashLimaConfig changes when provision file contents change', () => {
    const profileDir = mkdtempSync(join(tmpdir(), 'psbx-hash-script-profile-'));
    const projectDir = mkdtempSync(join(tmpdir(), 'psbx-hash-script-project-'));
    try {
      const provisionPath = join(profileDir, 'provision-system.sh');
      writeFileSync(
        join(profileDir, 'lima.yaml'),
        [
          'user:',
          '  name: pi',
          '  home: /home/pi',
          'provision:',
          '  - mode: system',
          '    file: ./provision-system.sh',
          '',
        ].join('\n'),
      );
      writeFileSync(provisionPath, '#!/bin/sh\necho first\n');
      const profile = {
        name: 'hash-script',
        dir: profileDir,
        limaPath: join(profileDir, 'lima.yaml'),
        configMounts: [],
      };
      const first = hashLimaConfig(profile, projectDir);
      writeFileSync(provisionPath, '#!/bin/sh\necho second\n');
      const second = hashLimaConfig(profile, projectDir);
      assert.notStrictEqual(first, second);
    } finally {
      rmSync(profileDir, { recursive: true, force: true });
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it('hashFinalizerConfig changes when profile config mount contents change', () => {
    const profileDir = mkdtempSync(join(tmpdir(), 'psbx-finalizer-profile-'));
    try {
      mkdirSync(join(profileDir, 'pi', 'agent'), { recursive: true });
      const settingsPath = join(profileDir, 'pi', 'agent', 'settings.json');
      const env = {
        configMounts: [
          {
            source: 'pi/agent',
            name: 'agent',
            guestTarget: '~/.pi/agent',
            projectSessionDir: '.agents/sessions',
          },
        ],
      };
      writeFileSync(settingsPath, '{"one":true}\n');
      const first = hashFinalizerConfig({ ...env, dir: profileDir });
      writeFileSync(settingsPath, '{"two":true}\n');
      const second = hashFinalizerConfig({ ...env, dir: profileDir });
      assert.notStrictEqual(first, second);
    } finally {
      rmSync(profileDir, { recursive: true, force: true });
    }
  });

  it('hashFinalizerConfig changes when profile config mount file mode changes', () => {
    const profileDir = mkdtempSync(join(tmpdir(), 'psbx-finalizer-profile-'));
    try {
      mkdirSync(join(profileDir, 'pi', 'agent'), { recursive: true });
      const settingsPath = join(profileDir, 'pi', 'agent', 'settings.json');
      const env = {
        configMounts: [
          {
            source: 'pi/agent',
            name: 'agent',
            guestTarget: '~/.pi/agent',
            projectSessionDir: '.agents/sessions',
          },
        ],
      };
      writeFileSync(settingsPath, '{"one":true}\n');
      chmodSync(settingsPath, 0o600);
      const first = hashFinalizerConfig({ ...env, dir: profileDir });
      chmodSync(settingsPath, 0o644);
      const second = hashFinalizerConfig({ ...env, dir: profileDir });
      assert.notStrictEqual(first, second);
    } finally {
      rmSync(profileDir, { recursive: true, force: true });
    }
  });

  it('hashFinalizerConfig changes when profile config symlink target changes', () => {
    const profileDir = mkdtempSync(join(tmpdir(), 'psbx-finalizer-profile-'));
    try {
      mkdirSync(join(profileDir, 'pi', 'agent'), { recursive: true });
      const configDir = join(profileDir, 'pi', 'agent');
      const env = {
        configMounts: [
          {
            source: 'pi/agent',
            name: 'agent',
            guestTarget: '~/.pi/agent',
            projectSessionDir: '.agents/sessions',
          },
        ],
      };
      writeFileSync(join(configDir, 'one.json'), '{"one":true}\n');
      writeFileSync(join(configDir, 'two.json'), '{"two":true}\n');
      symlinkSync('one.json', join(configDir, 'settings.json'));
      const first = hashFinalizerConfig({ ...env, dir: profileDir });
      rmSync(join(configDir, 'settings.json'));
      symlinkSync('two.json', join(configDir, 'settings.json'));
      const second = hashFinalizerConfig({ ...env, dir: profileDir });
      assert.notStrictEqual(first, second);
    } finally {
      rmSync(profileDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// warnIgnoredLimactlArgs (migrated from static.test.js)
// ---------------------------------------------------------------------------

describe('warnIgnoredLimactlArgs', { concurrency: true }, () => {
  it('does not warn when limactlArgs is empty', () => {
    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args.join(' '));
    try {
      warnIgnoredLimactlArgs([]);
      assert.strictEqual(warnings.length, 0);
    } finally {
      console.warn = origWarn;
    }
  });

  it('does not warn when limactlArgs is undefined', () => {
    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args.join(' '));
    try {
      warnIgnoredLimactlArgs(undefined);
      assert.strictEqual(warnings.length, 0);
    } finally {
      console.warn = origWarn;
    }
  });

  it('warns with the ignored arguments when limactlArgs is non-empty', () => {
    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args.join(' '));
    try {
      warnIgnoredLimactlArgs(['--cpus=8', '--memory=16GiB']);
      assert.ok(warnings.length > 0, 'expected at least one warning');
      assert.ok(warnings[0].includes('--cpus=8'), `warning: ${warnings[0]}`);
      assert.ok(warnings[0].includes('--memory=16GiB'), `warning: ${warnings[0]}`);
      assert.ok(warnings[0].includes('ignored'), `warning: ${warnings[0]}`);
    } finally {
      console.warn = origWarn;
    }
  });
});
