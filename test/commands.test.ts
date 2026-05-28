import assert from 'node:assert/strict';
import type { SpawnSyncReturns } from 'node:child_process';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { profileCacheInputs } from '../src/cache.ts';
import { loadEnv } from '../src/config.ts';
import type {
  CacheEntry,
  ConfigFileData,
  EnvConfig,
  LimaInstance,
  ProfileHashes,
  RegistryEntry,
} from '../src/types.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BIN = resolve(__dirname, '..', 'bin', 'psbx.ts');

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

describe('commands', { concurrency: false }, () => {
  let tmpHome: string;
  let projectDir: string;

  before(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'psbx-smoke-home-'));
    projectDir = mkdtempSync(join(tmpdir(), 'psbx-smoke-proj-'));
    // Initialise a self-test profile so commands can resolve config + profile
    run(['profile', 'init', 'self-test', '--self-test'], { HOME: tmpHome, cwd: projectDir });
  });

  after(() => {
    rmSync(tmpHome, { recursive: true, force: true });
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('[cmd] --version outputs the package version', () => {
    const r = run(['--version']);
    assert.strictEqual(r.status, 0);
    assert.ok(r.stdout.includes('0.2.0'), `stdout: ${r.stdout}`);
  });

  it('[cmd] --help lists every command', () => {
    const r = run(['--help']);
    assert.strictEqual(r.status, 0);
    for (const cmd of [
      'up',
      'exec',
      'stop',
      'restart',
      'delete',
      'cache',
      'profile',
      'status',
      'list',
      'logs',
      'completion',
    ]) {
      assert.ok(r.stdout.includes(cmd), `"${cmd}" missing from help:\n${r.stdout}`);
    }
  });

  it('[cmd] profile init --self-test creates a new profile', () => {
    const freshHome = mkdtempSync(join(tmpdir(), 'psbx-smoke-init-'));
    try {
      const r = run(['profile', 'init', 'myprofile', '--self-test'], {
        HOME: freshHome,
        cwd: projectDir,
      });
      assert.strictEqual(r.status, 0, `stderr: ${r.stderr}`);
      assert.ok(r.stdout.includes('Created profile'), `stdout: ${r.stdout}`);
    } finally {
      rmSync(freshHome, { recursive: true, force: true });
    }
  });

  it('[cmd] profile init --self-test fails when the profile already exists', () => {
    const r = run(['profile', 'init', 'self-test', '--self-test'], {
      HOME: tmpHome,
      cwd: projectDir,
    });
    assert.strictEqual(r.status, 1);
    assert.ok(r.stderr.includes('already exists'), `stderr: ${r.stderr}`);
  });

  it('[cmd] profile init --template copilot-in-ubuntu creates a copilot-only profile', () => {
    const home = mkdtempSync(join(tmpdir(), 'psbx-copilot-home-'));
    try {
      const r = run(['profile', 'init', 'co', '--template', 'copilot-in-ubuntu'], {
        HOME: home,
        cwd: projectDir,
      });
      assert.strictEqual(r.status, 0, `stderr: ${r.stderr}`);
      const profileDir = join(home, '.psbx', 'profiles', 'co');
      const env = loadEnv(profileDir);
      const names = env.configMounts.map((m) => m.name).sort();
      assert.deepStrictEqual(names, ['copilot']);
      // configMount source dirs should be created on disk
      for (const m of env.configMounts) {
        assert.ok(
          existsSync(join(profileDir, m.source)),
          `expected ${m.source} to exist in ${profileDir}`,
        );
      }
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('[cmd] profile init --template rejects unknown templates', () => {
    const home = mkdtempSync(join(tmpdir(), 'psbx-tpl-home-'));
    try {
      const r = run(['profile', 'init', 'x', '--template', 'does-not-exist'], {
        HOME: home,
        cwd: projectDir,
      });
      assert.strictEqual(r.status, 1);
      assert.ok(r.stderr.includes('Unknown profile template'), `stderr: ${r.stderr}`);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('[cmd] profile delete removes a profile', () => {
    const home = mkdtempSync(join(tmpdir(), 'psbx-delprof-'));
    try {
      run(['profile', 'init', 'foo', '--self-test'], { HOME: home, cwd: projectDir });
      assert.ok(existsSync(join(home, '.psbx', 'profiles', 'foo')));
      const r = run(['profile', 'delete', 'foo', '-f'], { HOME: home, cwd: projectDir });
      assert.strictEqual(r.status, 0, `stderr: ${r.stderr}`);
      assert.ok(r.stdout.includes('Deleted profile'), `stdout: ${r.stdout}`);
      assert.ok(!existsSync(join(home, '.psbx', 'profiles', 'foo')));
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('[cmd] profile delete --all removes all profiles', () => {
    const home = mkdtempSync(join(tmpdir(), 'psbx-delall-'));
    try {
      run(['profile', 'init', 'a', '--self-test'], { HOME: home, cwd: projectDir });
      run(['profile', 'init', 'b', '--self-test'], { HOME: home, cwd: projectDir });
      const r = run(['profile', 'delete', '--all', '-f'], { HOME: home, cwd: projectDir });
      assert.strictEqual(r.status, 0, `stderr: ${r.stderr}`);
      assert.ok(r.stdout.includes('All profiles have been deleted'), `stdout: ${r.stdout}`);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('[cmd] profile delete fails for nonexistent profile', () => {
    const home = mkdtempSync(join(tmpdir(), 'psbx-delnone-'));
    try {
      run(['profile', 'init', 'x', '--self-test'], { HOME: home, cwd: projectDir });
      const r = run(['profile', 'delete', 'nope', '-f'], { HOME: home, cwd: projectDir });
      assert.strictEqual(r.status, 1);
      assert.ok(r.stderr.includes('not found'), `stderr: ${r.stderr}`);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('[cmd] list reports no sandboxes on an empty registry', () => {
    const r = run(['list'], { HOME: tmpHome, cwd: projectDir });
    assert.strictEqual(r.status, 0);
    assert.ok(r.stdout.includes('No sandboxes created yet.'), `stdout: ${r.stdout}`);
  });

  // --- profile rename ---

  it('[cmd] profile rename moves a profile directory', () => {
    const home = mkdtempSync(join(tmpdir(), 'psbx-rename-'));
    try {
      run(['profile', 'init', 'old-name', '--self-test'], { HOME: home, cwd: projectDir });
      assert.ok(existsSync(join(home, '.psbx', 'profiles', 'old-name')));
      const r = run(['profile', 'rename', 'old-name', 'new-name'], { HOME: home, cwd: projectDir });
      assert.strictEqual(r.status, 0, `stderr: ${r.stderr}`);
      assert.ok(r.stdout.includes('Renamed profile'), `stdout: ${r.stdout}`);
      assert.ok(!existsSync(join(home, '.psbx', 'profiles', 'old-name')));
      assert.ok(existsSync(join(home, '.psbx', 'profiles', 'new-name')));
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('[cmd] profile rename updates defaultProfile', () => {
    const home = mkdtempSync(join(tmpdir(), 'psbx-rename-def-'));
    try {
      run(['profile', 'init', 'alpha', '--self-test', '--set-as-default'], {
        HOME: home,
        cwd: projectDir,
      });
      const r = run(['profile', 'rename', 'alpha', 'beta'], { HOME: home, cwd: projectDir });
      assert.strictEqual(r.status, 0, `stderr: ${r.stderr}`);
      const configRaw = readFileSync(join(home, '.psbx', 'config.json'), 'utf-8');
      const config = JSON.parse(configRaw) as { defaultProfile?: string };
      assert.strictEqual(config.defaultProfile, 'beta');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('[cmd] profile rename updates VM registry entries', () => {
    const home = mkdtempSync(join(tmpdir(), 'psbx-rename-vm-'));
    try {
      run(['profile', 'init', 'src', '--self-test'], { HOME: home, cwd: projectDir });
      // Manually write a registry entry pointing to the profile
      const configPath = join(home, '.psbx', 'config.json');
      const config = JSON.parse(readFileSync(configPath, 'utf-8')) as ConfigFileData;
      config.vms = { 'test-vm': { projectDir: '/tmp/test', profile: 'src' } };
      writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
      const r = run(['profile', 'rename', 'src', 'dst'], { HOME: home, cwd: projectDir });
      assert.strictEqual(r.status, 0, `stderr: ${r.stderr}`);
      const updated = JSON.parse(readFileSync(configPath, 'utf-8')) as ConfigFileData;
      assert.strictEqual(updated.vms?.['test-vm']?.profile, 'dst');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('[cmd] profile rename updates cache registry entries', () => {
    const home = mkdtempSync(join(tmpdir(), 'psbx-rename-cache-'));
    try {
      run(['profile', 'init', 'old', '--self-test'], { HOME: home, cwd: projectDir });
      const configPath = join(home, '.psbx', 'config.json');
      const config = JSON.parse(readFileSync(configPath, 'utf-8')) as ConfigFileData;
      config.caches = {
        'psbx-cache-abc': {
          profile: 'old',
          cacheKey: 'abc123',
          limaVersion: '1.0',
          createdAt: null,
        },
      };
      writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
      const r = run(['profile', 'rename', 'old', 'new'], { HOME: home, cwd: projectDir });
      assert.strictEqual(r.status, 0, `stderr: ${r.stderr}`);
      const updated = JSON.parse(readFileSync(configPath, 'utf-8')) as ConfigFileData;
      assert.strictEqual(updated.caches?.['psbx-cache-abc']?.profile, 'new');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('[cmd] profile rename fails when src does not exist', () => {
    const home = mkdtempSync(join(tmpdir(), 'psbx-rename-nosrc-'));
    try {
      const r = run(['profile', 'rename', 'nope', 'dest'], { HOME: home, cwd: projectDir });
      assert.strictEqual(r.status, 1);
      assert.ok(r.stderr.includes('not found'), `stderr: ${r.stderr}`);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('[cmd] profile rename refuses to overwrite without --force', () => {
    const home = mkdtempSync(join(tmpdir(), 'psbx-rename-exists-'));
    try {
      run(['profile', 'init', 'a', '--self-test'], { HOME: home, cwd: projectDir });
      run(['profile', 'init', 'b', '--self-test'], { HOME: home, cwd: projectDir });
      const r = run(['profile', 'rename', 'a', 'b'], { HOME: home, cwd: projectDir });
      assert.strictEqual(r.status, 1);
      assert.ok(r.stderr.includes('already exists'), `stderr: ${r.stderr}`);
      // Both profiles should still exist
      assert.ok(existsSync(join(home, '.psbx', 'profiles', 'a')));
      assert.ok(existsSync(join(home, '.psbx', 'profiles', 'b')));
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('[cmd] profile rename --force overwrites existing dest', () => {
    const home = mkdtempSync(join(tmpdir(), 'psbx-rename-force-'));
    try {
      run(['profile', 'init', 'a', '--self-test'], { HOME: home, cwd: projectDir });
      run(['profile', 'init', 'b', '--self-test'], { HOME: home, cwd: projectDir });
      const r = run(['profile', 'rename', 'a', 'b', '--force'], { HOME: home, cwd: projectDir });
      assert.strictEqual(r.status, 0, `stderr: ${r.stderr}`);
      assert.ok(!existsSync(join(home, '.psbx', 'profiles', 'a')));
      assert.ok(existsSync(join(home, '.psbx', 'profiles', 'b')));
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('[cmd] profile rename requires both arguments', () => {
    const home = mkdtempSync(join(tmpdir(), 'psbx-rename-args-'));
    try {
      const r = run(['profile', 'rename'], { HOME: home, cwd: projectDir });
      assert.strictEqual(r.status, 1);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('[cmd] profile list shows existing profiles', () => {
    const r = run(['profile', 'list'], { HOME: tmpHome, cwd: projectDir });
    assert.strictEqual(r.status, 0, `stderr: ${r.stderr}`);
    assert.ok(r.stdout.includes('self-test'), `stdout: ${r.stdout}`);
  });

  it('[cmd] cache list reports no caches on an empty registry', () => {
    const r = run(['cache', 'list'], { HOME: tmpHome, cwd: projectDir });
    assert.strictEqual(r.status, 0, `stderr: ${r.stderr}`);
    assert.ok(r.stdout.includes('No profile caches created yet.'), `stdout: ${r.stdout}`);
  });

  it('[cmd] profile set-default marks a profile as default', () => {
    const home = mkdtempSync(join(tmpdir(), 'psbx-set-default-'));
    try {
      run(['profile', 'init', 'a', '--self-test'], { HOME: home, cwd: projectDir });
      run(['profile', 'init', 'b', '--self-test'], { HOME: home, cwd: projectDir });
      const setBefore = run(['profile', 'set-default', 'b'], { HOME: home, cwd: projectDir });
      assert.strictEqual(setBefore.status, 0, `stderr: ${setBefore.stderr}`);
      const listResult = run(['profile', 'list'], { HOME: home, cwd: projectDir });
      assert.ok(listResult.stdout.includes('b (*)'), `expected b (*) in:\n${listResult.stdout}`);
      assert.ok(
        !listResult.stdout.includes('a (*)'),
        `expected a without (*) in:\n${listResult.stdout}`,
      );
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('[cmd] cache commands list, report, and delete the current project hit', () => {
    const home = mkdtempSync(join(tmpdir(), 'psbx-cache-cmd-home-'));
    const project = mkdtempSync(join(tmpdir(), 'psbx-cache-cmd-project-'));
    try {
      const initResult = run(['profile', 'init', 'self-test', '--self-test'], {
        HOME: home,
        cwd: project,
      });
      assert.strictEqual(initResult.status, 0, `stderr: ${initResult.stderr}`);

      const profileDir = join(home, '.psbx', 'profiles', 'self-test');
      const profile = {
        name: 'self-test',
        dir: profileDir,
        limaPath: join(profileDir, 'lima.yaml'),
        ...loadEnv(profileDir),
      };
      const fake = writeFakeLimactl({});
      const prevPath = process.env.PATH;
      const prevState = process.env.PI_TEST_LIMA_STATE;
      let cacheName: string;
      let cacheKey: string;
      try {
        process.env.PATH = `${fake.binDir}:${prevPath}`;
        process.env.PI_TEST_LIMA_STATE = fake.statePath;
        ({ cacheName, cacheKey } = profileCacheInputs(profile, project));
      } finally {
        process.env.PATH = prevPath;
        if (prevState === undefined) {
          delete process.env.PI_TEST_LIMA_STATE;
        } else {
          process.env.PI_TEST_LIMA_STATE = prevState;
        }
      }
      writeCacheRegistry(home, {
        [cacheName]: {
          profile: 'self-test',
          cacheKey,
          createdAt: '2026-05-12T00:00:00.000Z',
        },
      });

      const fakeWithState = writeFakeLimactl({
        [cacheName]: { name: cacheName, status: 'Stopped', config: { disk: '8GiB' } },
      });
      const env = {
        PATH: `${fakeWithState.binDir}:${process.env.PATH}`,
        PI_TEST_LIMA_STATE: fakeWithState.statePath,
      };

      const listResult = run(['cache', 'list'], { HOME: home, cwd: project, env });
      assert.strictEqual(listResult.status, 0, `stderr: ${listResult.stderr}`);
      assert.ok(listResult.stdout.includes(cacheName), `stdout: ${listResult.stdout}`);
      assert.ok(listResult.stdout.includes('self-test'), `stdout: ${listResult.stdout}`);
      assert.ok(listResult.stdout.includes('8GiB'), `stdout: ${listResult.stdout}`);

      const statusResult = run(['cache', 'status'], { HOME: home, cwd: project, env });
      assert.strictEqual(statusResult.status, 0, `stderr: ${statusResult.stderr}`);
      assert.ok(
        statusResult.stdout.includes(`HIT:  ${cacheName}`),
        `stdout: ${statusResult.stdout}`,
      );

      const deleteResult = run(['cache', 'delete', '--force'], { HOME: home, cwd: project, env });
      assert.strictEqual(deleteResult.status, 0, `stderr: ${deleteResult.stderr}`);
      assert.ok(
        deleteResult.stdout.includes(`Deleted profile cache "${cacheName}".`),
        `stdout: ${deleteResult.stdout}`,
      );

      const listAfterDelete = run(['cache', 'list'], { HOME: home, cwd: project, env });
      assert.strictEqual(listAfterDelete.status, 0, `stderr: ${listAfterDelete.stderr}`);
      assert.ok(
        listAfterDelete.stdout.includes('No profile caches created yet.'),
        `stdout: ${listAfterDelete.stdout}`,
      );
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(project, { recursive: true, force: true });
    }
  });

  it('[cmd] cache delete --all removes all registered caches', () => {
    const home = mkdtempSync(join(tmpdir(), 'psbx-cache-delall-home-'));
    const project = mkdtempSync(join(tmpdir(), 'psbx-cache-delall-project-'));
    try {
      const initResult = run(['profile', 'init', 'self-test', '--self-test'], {
        HOME: home,
        cwd: project,
      });
      assert.strictEqual(initResult.status, 0, `stderr: ${initResult.stderr}`);

      writeCacheRegistry(home, {
        'psbx-cache-self-test-a': {
          profile: 'self-test',
          cacheKey: 'a'.repeat(64),
          createdAt: '2026-05-12T00:00:00.000Z',
        },
        'psbx-cache-self-test-b': {
          profile: 'self-test',
          cacheKey: 'b'.repeat(64),
          createdAt: '2026-05-12T00:00:00.000Z',
        },
      });

      const fake = writeFakeLimactl({
        'psbx-cache-self-test-a': {
          name: 'psbx-cache-self-test-a',
          status: 'Stopped',
          config: { disk: '8GiB' },
        },
        'psbx-cache-self-test-b': {
          name: 'psbx-cache-self-test-b',
          status: 'Running',
          config: { disk: '16GiB' },
        },
      });
      const env = {
        PATH: `${fake.binDir}:${process.env.PATH}`,
        PI_TEST_LIMA_STATE: fake.statePath,
      };

      const deleteResult = run(['cache', 'delete', '--all', '--force'], {
        HOME: home,
        cwd: project,
        env,
      });
      assert.strictEqual(deleteResult.status, 0, `stderr: ${deleteResult.stderr}`);
      assert.ok(
        deleteResult.stdout.includes('All profile caches have been deleted.'),
        `stdout: ${deleteResult.stdout}`,
      );

      const config = JSON.parse(readFileSync(join(home, '.psbx', 'config.json'), 'utf-8'));
      assert.strictEqual(config.caches, undefined);
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(project, { recursive: true, force: true });
    }
  });

  it('[cmd] cache status uses the current project registry profile before default', () => {
    const home = mkdtempSync(join(tmpdir(), 'psbx-cache-registry-profile-home-'));
    const project = mkdtempSync(join(tmpdir(), 'psbx-cache-registry-profile-project-'));
    try {
      const initDefault = run(['profile', 'init', 'default-profile', '--self-test'], {
        HOME: home,
        cwd: project,
      });
      assert.strictEqual(initDefault.status, 0, `stderr: ${initDefault.stderr}`);
      const initProject = run(
        ['profile', 'init', 'project-profile', '--from-profile', 'default-profile'],
        {
          HOME: home,
          cwd: project,
        },
      );
      assert.strictEqual(initProject.status, 0, `stderr: ${initProject.stderr}`);

      writeRegistry(home, project, { profile: 'project-profile' });

      const profileDir = join(home, '.psbx', 'profiles', 'project-profile');
      const profile = {
        name: 'project-profile',
        dir: profileDir,
        limaPath: join(profileDir, 'lima.yaml'),
        ...loadEnv(profileDir),
      };
      const fake = writeFakeLimactl({});
      const prevPath = process.env.PATH;
      const prevState = process.env.PI_TEST_LIMA_STATE;
      let cacheName: string;
      let cacheKey: string;
      try {
        process.env.PATH = `${fake.binDir}:${prevPath}`;
        process.env.PI_TEST_LIMA_STATE = fake.statePath;
        ({ cacheName, cacheKey } = profileCacheInputs(profile, project));
      } finally {
        process.env.PATH = prevPath;
        if (prevState === undefined) {
          delete process.env.PI_TEST_LIMA_STATE;
        } else {
          process.env.PI_TEST_LIMA_STATE = prevState;
        }
      }

      writeCacheRegistry(home, {
        [cacheName]: {
          profile: 'project-profile',
          cacheKey,
          createdAt: '2026-05-12T00:00:00.000Z',
        },
      });

      const fakeWithState = writeFakeLimactl({
        [cacheName]: { name: cacheName, status: 'Stopped', config: { disk: '8GiB' } },
      });
      const env = {
        PATH: `${fakeWithState.binDir}:${process.env.PATH}`,
        PI_TEST_LIMA_STATE: fakeWithState.statePath,
      };

      const statusResult = run(['cache', 'status'], { HOME: home, cwd: project, env });
      assert.strictEqual(statusResult.status, 0, `stderr: ${statusResult.stderr}`);
      assert.ok(
        statusResult.stdout.includes(`HIT:  ${cacheName}`),
        `stdout: ${statusResult.stdout}`,
      );
      assert.ok(statusResult.stdout.includes('project-profile'), `stdout: ${statusResult.stdout}`);
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(project, { recursive: true, force: true });
    }
  });

  it('[cmd] profile cache names stay short for long profile names', () => {
    const home = mkdtempSync(join(tmpdir(), 'psbx-cache-short-name-home-'));
    const project = mkdtempSync(join(tmpdir(), 'psbx-cache-short-name-project-'));
    const profileName = 'copied-from-vm-with-a-very-long-name';
    try {
      const initResult = run(['profile', 'init', profileName, '--self-test'], {
        HOME: home,
        cwd: project,
      });
      assert.strictEqual(initResult.status, 0, `stderr: ${initResult.stderr}`);

      const profileDir = join(home, '.psbx', 'profiles', profileName);
      const profile = {
        name: profileName,
        dir: profileDir,
        limaPath: join(profileDir, 'lima.yaml'),
        ...loadEnv(profileDir),
      };
      const fake = writeFakeLimactl({});
      const prevPath = process.env.PATH;
      const prevState = process.env.PI_TEST_LIMA_STATE;
      let cacheName: string;
      try {
        process.env.PATH = `${fake.binDir}:${prevPath}`;
        process.env.PI_TEST_LIMA_STATE = fake.statePath;
        ({ cacheName } = profileCacheInputs(profile, project));
      } finally {
        process.env.PATH = prevPath;
        if (prevState === undefined) {
          delete process.env.PI_TEST_LIMA_STATE;
        } else {
          process.env.PI_TEST_LIMA_STATE = prevState;
        }
      }

      assert.ok(cacheName.length <= 31, `cache name too long: ${cacheName}`);
      assert.match(cacheName, /^psbx-cache-[a-f0-9]{12}$/);
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(project, { recursive: true, force: true });
    }
  });

  it('[cmd] status reports Not created when VM is absent', () => {
    const r = run(['status'], { HOME: tmpHome, cwd: projectDir });
    assert.strictEqual(r.status, 0);
    assert.ok(r.stdout.includes('Not created'), `stdout: ${r.stdout}`);
  });

  it('[cmd] status text output handles Lima string resource sizes', () => {
    const home = mkdtempSync(join(tmpdir(), 'psbx-status-size-home-'));
    const project = mkdtempSync(join(tmpdir(), 'psbx-status-size-project-'));
    try {
      const initResult = run(['profile', 'init', 'self-test', '--self-test'], {
        HOME: home,
        cwd: project,
      });
      assert.strictEqual(initResult.status, 0, `stderr: ${initResult.stderr}`);

      writeRegistry(home, project, { profile: 'self-test' });
      const vmName = vmNameFrom(project);
      const fake = writeFakeLimactl({
        [vmName]: {
          name: vmName,
          status: 'Running',
          config: { cpus: 3, memory: '1GiB', disk: '12GiB' },
          sshLocalPort: 60022,
        },
      });
      const env = {
        PATH: `${fake.binDir}:${process.env.PATH}`,
        PI_TEST_LIMA_STATE: fake.statePath,
      };

      const r = run(['status'], { HOME: home, cwd: project, env });
      assert.strictEqual(r.status, 0, `stderr: ${r.stderr}`);
      assert.ok(r.stdout.includes('Status:     Running'), `stdout: ${r.stdout}`);
      assert.ok(r.stdout.includes('Memory:     1GiB'), `stdout: ${r.stdout}`);
      assert.ok(r.stdout.includes('Disk:       12GiB'), `stdout: ${r.stdout}`);
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(project, { recursive: true, force: true });
    }
  });

  it('[cmd] up --only-create exits 1 when the requested profile does not exist', () => {
    const r = run(['up', '--only-create', '--profile', 'nonexistent-xyz'], {
      HOME: tmpHome,
      cwd: projectDir,
    });
    assert.strictEqual(r.status, 1);
    assert.ok(r.stderr.includes('not found'), `stderr: ${r.stderr}`);
  });

  for (const cmd of ['stop', 'delete']) {
    it(`[cmd] ${cmd} exits 1 with "does not exist" when VM is absent`, () => {
      const r = run([cmd], { HOME: tmpHome, cwd: projectDir });
      assert.strictEqual(r.status, 1);
      assert.ok(r.stderr.includes('does not exist'), `stderr: ${r.stderr}`);
    });
  }

  it('[cmd] logs exits 1 with "Nothing to show" when neither project nor cache VM exist', () => {
    const r = run(['logs'], { HOME: tmpHome, cwd: projectDir });
    assert.strictEqual(r.status, 1);
    assert.ok(r.stderr.includes('Nothing to show'), `stderr: ${r.stderr}`);
  });

  it('[cmd] exec exits 1 with "does not exist" when VM is absent', () => {
    const r = run(['exec', '--', 'echo', 'hello'], { HOME: tmpHome, cwd: projectDir });
    assert.strictEqual(r.status, 1);
    assert.ok(r.stderr.includes('does not exist'), `stderr: ${r.stderr}`);
  });

  it('[cmd] restart exits 1 with "does not exist" when VM is absent', () => {
    const r = run(['restart'], { HOME: tmpHome, cwd: projectDir });
    assert.strictEqual(r.status, 1);
    assert.ok(r.stderr.includes('does not exist'), `stderr: ${r.stderr}`);
  });

  it('[cmd] up --only-recreate exits 1 with "does not exist" when VM is absent', () => {
    const r = run(['up', '--only-recreate', '--profile', 'self-test'], {
      HOME: tmpHome,
      cwd: projectDir,
    });
    assert.strictEqual(r.status, 1);
    assert.ok(r.stderr.includes('does not exist'), `stderr: ${r.stderr}`);
  });

  it('[cmd] up --only-start exits 1 with "does not exist" when VM is absent', () => {
    const r = run(['up', '--only-start', '--profile', 'self-test'], {
      HOME: tmpHome,
      cwd: projectDir,
    });
    assert.strictEqual(r.status, 1);
    assert.ok(r.stderr.includes('does not exist'), `stderr: ${r.stderr}`);
  });

  it('[cmd] up --force-recreate warns and creates when VM is absent', () => {
    const r = run(['up', '--force-recreate', '--profile', 'self-test'], {
      HOME: tmpHome,
      cwd: projectDir,
    });
    // It will fail at the actual limactl create step (no limactl in test env),
    // but we should see the warning in stderr before that
    assert.ok(
      r.stderr.includes('does not exist. Creating instead of recreating'),
      `expected warning in stderr:\n${r.stderr}`,
    );
  });

  it('[cmd] up --force-recreate and --only-create are mutually exclusive', () => {
    const r = run(['up', '--force-recreate', '--only-create', '--profile', 'self-test'], {
      HOME: tmpHome,
      cwd: projectDir,
    });
    assert.strictEqual(r.status, 1);
    assert.ok(r.stderr.includes('mutually exclusive'), `stderr: ${r.stderr}`);
  });

  it('[cmd] up --only-create exits 1 when .agents is a symlink', () => {
    const symlinkProj = mkdtempSync(join(tmpdir(), 'psbx-symlink-proj-'));
    const symlinkTarget = mkdtempSync(join(tmpdir(), 'psbx-symlink-target-'));
    try {
      symlinkSync(symlinkTarget, join(symlinkProj, '.agents'));
      const r = run(['up', '--only-create', '--profile', 'self-test'], {
        HOME: tmpHome,
        cwd: symlinkProj,
      });
      assert.strictEqual(r.status, 1, `expected exit 1, got ${r.status}; stderr: ${r.stderr}`);
      assert.ok(r.stderr.includes('symlink'), `expected "symlink" in stderr:\n${r.stderr}`);
    } finally {
      rmSync(symlinkProj, { recursive: true, force: true });
      rmSync(symlinkTarget, { recursive: true, force: true });
    }
  });

  // --- inconsistency and limactlArgs warning (integration) ---

  function vmNameFrom(dir: string) {
    return basename(dir)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function writeRegistry(home: string, projectDir: string, overrides: Partial<RegistryEntry> = {}) {
    const vmName = vmNameFrom(projectDir);
    const { profile, ...rest } = overrides;
    const entry: RegistryEntry = {
      projectDir,
      profile: profile ?? 'self-test',
      ...rest,
    };
    const registry: Record<string, RegistryEntry> = { [vmName]: entry };
    const configPath = join(home, '.psbx', 'config.json');
    let existing: ConfigFileData = {};
    try {
      existing = JSON.parse(readFileSync(configPath, 'utf-8'));
    } catch {
      existing = {};
    }
    existing.vms = registry;
    writeFileSync(configPath, `${JSON.stringify(existing, null, 2)}\n`, 'utf-8');
  }

  function writeCacheRegistry(home: string, caches: Record<string, CacheEntry>) {
    const configPath = join(home, '.psbx', 'config.json');
    let existing: ConfigFileData = {};
    try {
      existing = JSON.parse(readFileSync(configPath, 'utf-8'));
    } catch {
      existing = {};
    }
    existing.caches = caches;
    writeFileSync(configPath, `${JSON.stringify(existing, null, 2)}\n`, 'utf-8');
  }

  function writeFakeLimactl(instances: Record<string, LimaInstance>) {
    const binDir = mkdtempSync(join(tmpdir(), 'psbx-fake-limactl-bin-'));
    const statePath = join(binDir, 'state.json');
    writeFileSync(statePath, JSON.stringify({ instances }, null, 2), 'utf-8');
    const scriptPath = join(binDir, 'limactl');
    writeFileSync(
      scriptPath,
      `#!/usr/bin/env node
const fs = require('node:fs');

const statePath = process.env.PI_TEST_LIMA_STATE;
const args = process.argv.slice(2);

function load() {
  return JSON.parse(fs.readFileSync(statePath, 'utf-8'));
}

function save(state) {
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}

const state = load();

if (args[0] === '--version') {
  console.log('limactl fake');
  process.exit(0);
}

if (args[0] === 'ls' && args[1] === '--json') {
  for (const instance of Object.values(state.instances)) {
    console.log(JSON.stringify(instance));
  }
  process.exit(0);
}

if (args[0] === 'ls' && args[1] === '-f') {
  const name = args[3];
  const instance = state.instances[name];
  if (!instance) {
    console.error('instance not found');
    process.exit(1);
  }
  console.log(instance.status);
  process.exit(0);
}

if (args[0] === 'stop') {
  const name = args[1] === '--force' ? args[2] : args[1];
  if (state.instances[name]) {
    state.instances[name].status = 'Stopped';
    save(state);
  }
  process.exit(0);
}

if (args[0] === 'delete') {
  delete state.instances[args[1]];
  save(state);
  process.exit(0);
}

console.error('unsupported fake limactl args: ' + args.join(' '));
process.exit(1);
`,
      'utf-8',
    );
    chmodSync(scriptPath, 0o755);
    return { binDir, statePath };
  }

  it('[cmd] status includes environment info from profile env.yaml', () => {
    const projDir = mkdtempSync(join(tmpdir(), 'psbx-status-env-'));
    const home = mkdtempSync(join(tmpdir(), 'psbx-status-env-home-'));
    try {
      run(['profile', 'init', 'self-test', '--self-test'], { HOME: home, cwd: projDir });

      const vmName = vmNameFrom(projDir);
      writeRegistry(home, projDir, { profile: 'self-test' });
      const fake = writeFakeLimactl({
        [vmName]: { name: vmName, status: 'Running', config: { cpus: 2 } },
      });
      const env = {
        PATH: `${fake.binDir}:${process.env.PATH}`,
        PI_TEST_LIMA_STATE: fake.statePath,
      };

      // Text output
      const r = run(['status'], { HOME: home, cwd: projDir, env });
      assert.strictEqual(r.status, 0, `stderr: ${r.stderr}`);
      assert.ok(r.stdout.includes('Environment:'), `stdout: ${r.stdout}`);
      assert.ok(r.stdout.includes('Config mounts:'), `stdout: ${r.stdout}`);

      // JSON output
      const rj = run(['status', '--json'], { HOME: home, cwd: projDir, env });
      assert.strictEqual(rj.status, 0, `stderr: ${rj.stderr}`);
      const info = JSON.parse(rj.stdout) as { env: EnvConfig };
      assert.ok(info.env, 'JSON output should include env');
      assert.ok(Array.isArray(info.env.configMounts), 'env.configMounts should be an array');
    } finally {
      rmSync(projDir, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('[cmd] status shows "In sync" when hashes match', () => {
    const projDir = mkdtempSync(join(tmpdir(), 'psbx-status-sync-'));
    const home = mkdtempSync(join(tmpdir(), 'psbx-status-sync-home-'));
    try {
      run(['profile', 'init', 'self-test', '--self-test'], { HOME: home, cwd: projDir });

      const vmName = vmNameFrom(projDir);

      // Compute correct hashes by spawning a helper with the right HOME
      const hashScript = `
        import { resolveProfile } from '${resolve(__dirname, '..', 'src', 'config.ts').replace(/\\/g, '/')}';
        import { profileHashes } from '${resolve(__dirname, '..', 'src', 'commands', 'helpers.ts').replace(/\\/g, '/')}';
        const profile = resolveProfile({ defaultProfile: 'self-test' }, 'self-test');
        const hashes = profileHashes(profile, process.cwd());
        console.log(JSON.stringify(hashes));
      `;
      const hashResult = spawnSync(process.execPath, ['--input-type=module', '-e', hashScript], {
        encoding: 'utf-8',
        env: { ...process.env, HOME: home },
        cwd: projDir,
      });
      assert.strictEqual(hashResult.status, 0, `hash script failed: ${hashResult.stderr}`);
      const hashes = JSON.parse(hashResult.stdout.trim()) as ProfileHashes;

      writeRegistry(home, projDir, { profile: 'self-test', ...hashes });
      const fake = writeFakeLimactl({
        [vmName]: { name: vmName, status: 'Running', config: { cpus: 2 } },
      });
      const env = {
        PATH: `${fake.binDir}:${process.env.PATH}`,
        PI_TEST_LIMA_STATE: fake.statePath,
      };

      const r = run(['status'], { HOME: home, cwd: projDir, env });
      assert.strictEqual(r.status, 0, `stderr: ${r.stderr}`);
      assert.ok(r.stdout.includes('✓ In sync'), `stdout: ${r.stdout}`);
    } finally {
      rmSync(projDir, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('[cmd] status shows "Out of sync" when hashes mismatch', () => {
    const projDir = mkdtempSync(join(tmpdir(), 'psbx-status-drift-'));
    const home = mkdtempSync(join(tmpdir(), 'psbx-status-drift-home-'));
    try {
      run(['profile', 'init', 'self-test', '--self-test'], { HOME: home, cwd: projDir });

      const vmName = vmNameFrom(projDir);
      writeRegistry(home, projDir, {
        profile: 'self-test',
        defaultCmdHash: 'stale-cmd-hash',
        finalizerHash: 'stale-finalizer-hash',
      });
      const fake = writeFakeLimactl({
        [vmName]: { name: vmName, status: 'Running', config: { cpus: 2 } },
      });
      const env = {
        PATH: `${fake.binDir}:${process.env.PATH}`,
        PI_TEST_LIMA_STATE: fake.statePath,
      };

      // self-test is the default profile → hints must NOT include --profile
      const r = run(['status'], { HOME: home, cwd: projDir, env });
      assert.strictEqual(r.status, 0, `stderr: ${r.stderr}`);
      assert.ok(r.stdout.includes('✗ Out of sync'), `stdout: ${r.stdout}`);
      assert.ok(
        r.stdout.includes('Config mount contents or structure have changed'),
        `stdout: ${r.stdout}`,
      );
      assert.ok(r.stdout.includes('Default command has changed'), `stdout: ${r.stdout}`);
      assert.ok(r.stdout.includes('psbx up'), `stdout: ${r.stdout}`);
      assert.ok(r.stdout.includes('psbx exec'), `stdout: ${r.stdout}`);
      assert.ok(
        !r.stdout.includes('--profile'),
        `hint must not include --profile when VM uses the default profile; stdout: ${r.stdout}`,
      );
    } finally {
      rmSync(projDir, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('[cmd] status drift hints include --profile when VM uses a non-default profile', () => {
    const projDir = mkdtempSync(join(tmpdir(), 'psbx-status-drift-prof-'));
    const home = mkdtempSync(join(tmpdir(), 'psbx-status-drift-prof-home-'));
    try {
      // Init two profiles: default is 'base', VM uses 'custom'
      run(['profile', 'init', 'base', '--self-test'], { HOME: home, cwd: projDir });
      run(['profile', 'init', 'custom', '--self-test'], { HOME: home, cwd: projDir });
      // Ensure 'base' is the global default
      run(['profile', 'set-default', 'base'], { HOME: home, cwd: projDir });

      const vmName = vmNameFrom(projDir);
      writeRegistry(home, projDir, {
        profile: 'custom',
        defaultCmdHash: 'stale-cmd-hash',
        finalizerHash: 'stale-finalizer-hash',
      });
      const fake = writeFakeLimactl({
        [vmName]: { name: vmName, status: 'Running', config: { cpus: 2 } },
      });
      const env = {
        PATH: `${fake.binDir}:${process.env.PATH}`,
        PI_TEST_LIMA_STATE: fake.statePath,
      };

      const r = run(['status'], { HOME: home, cwd: projDir, env });
      assert.strictEqual(r.status, 0, `stderr: ${r.stderr}`);
      assert.ok(r.stdout.includes('✗ Out of sync'), `stdout: ${r.stdout}`);
      // All up-hints must include --profile custom
      assert.ok(
        r.stdout.includes('--profile custom'),
        `hint must include --profile custom; stdout: ${r.stdout}`,
      );
      // Must not suggest the bare psbx up (without --profile)
      assert.ok(
        !r.stdout.includes('`psbx up`'),
        `bare psbx up hint must not appear; stdout: ${r.stdout}`,
      );
    } finally {
      rmSync(projDir, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('[cmd] up uses detailed reason format when registry entry exists but VM does not', () => {
    const projDir = mkdtempSync(join(tmpdir(), 'psbx-reason-fmt-'));
    const home = mkdtempSync(join(tmpdir(), 'psbx-reason-home-'));
    try {
      run(['profile', 'init', 'self-test', '--self-test'], { HOME: home, cwd: projDir });
      writeRegistry(home, projDir, { profile: 'self-test' });
      const fake = writeFakeLimactl({});
      const env = {
        PATH: `${fake.binDir}:${process.env.PATH}`,
        PI_TEST_LIMA_STATE: fake.statePath,
      };
      const r = run(['up', '--profile', 'self-test'], {
        HOME: home,
        cwd: projDir,
        input: 'n\n',
        env,
      });
      assert.ok(
        r.stdout.includes('is inconsistent with the requested configuration:'),
        `expected detailed reason format in stdout:\n${r.stdout}`,
      );
      assert.ok(
        r.stdout.includes('registry entry exists but VM does not'),
        `expected specific reason in stdout:\n${r.stdout}`,
      );
    } finally {
      rmSync(projDir, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  // --- completion command tests ---

  it('[cmd] completion bash outputs a valid completion script', () => {
    const r = run(['completion', 'bash']);
    assert.strictEqual(r.status, 0, `stderr: ${r.stderr}`);
    assert.ok(r.stdout.includes('_psbx'), `stdout: ${r.stdout}`);
    assert.ok(r.stdout.includes('complete -F'), `stdout: ${r.stdout}`);
  });

  it('[cmd] completion zsh outputs a valid completion script', () => {
    const r = run(['completion', 'zsh']);
    assert.strictEqual(r.status, 0, `stderr: ${r.stderr}`);
    assert.ok(r.stdout.includes('#compdef psbx'), `stdout: ${r.stdout}`);
    assert.ok(r.stdout.includes('compdef _psbx'), `stdout: ${r.stdout}`);
  });

  it('[cmd] completion fish outputs a valid completion script', () => {
    const r = run(['completion', 'fish']);
    assert.strictEqual(r.status, 0, `stderr: ${r.stderr}`);
    assert.ok(r.stdout.includes('complete -c psbx'), `stdout: ${r.stdout}`);
  });

  it('[cmd] completion with unsupported shell exits 1', () => {
    const r = run(['completion', 'powershell']);
    assert.strictEqual(r.status, 1);
    assert.ok(r.stderr.includes('Unsupported shell'), `stderr: ${r.stderr}`);
  });

  // --- profile init additional options ---

  it('[cmd] profile init --from-profile copies an existing profile', () => {
    const home = mkdtempSync(join(tmpdir(), 'psbx-from-prof-'));
    try {
      run(['profile', 'init', 'source', '--self-test'], { HOME: home, cwd: projectDir });
      const r = run(['profile', 'init', 'copy', '--from-profile', 'source'], {
        HOME: home,
        cwd: projectDir,
      });
      assert.strictEqual(r.status, 0, `stderr: ${r.stderr}`);
      assert.ok(r.stdout.includes('Created profile'), `stdout: ${r.stdout}`);
      assert.ok(existsSync(join(home, '.psbx', 'profiles', 'copy')));
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('[cmd] profile init --set-as-default sets the new profile as default', () => {
    const home = mkdtempSync(join(tmpdir(), 'psbx-set-default-'));
    try {
      run(['profile', 'init', 'first', '--self-test'], { HOME: home, cwd: projectDir });
      const r = run(['profile', 'init', 'second', '--self-test', '--set-as-default'], {
        HOME: home,
        cwd: projectDir,
      });
      assert.strictEqual(r.status, 0, `stderr: ${r.stderr}`);
      assert.ok(r.stdout.includes('Set "second" as the default profile'), `stdout: ${r.stdout}`);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  // --- profile list --plain ---

  it('[cmd] profile list --plain outputs bare profile names', () => {
    const r = run(['profile', 'list', '--plain'], { HOME: tmpHome, cwd: projectDir });
    assert.strictEqual(r.status, 0, `stderr: ${r.stderr}`);
    assert.ok(r.stdout.includes('self-test'), `stdout: ${r.stdout}`);
    // --plain should not include markers like (*)
    assert.ok(!r.stdout.includes('(*)'), `stdout should not include (*): ${r.stdout}`);
  });

  it('[cmd] profile list excludes hidden directories', () => {
    const home = mkdtempSync(join(tmpdir(), 'psbx-list-hidden-'));
    try {
      run(['profile', 'init', 'visible', '--self-test'], { HOME: home, cwd: projectDir });
      // Create a hidden directory alongside the real profile
      mkdirSync(join(home, '.psbx', 'profiles', '.hidden'), { recursive: true });
      const r = run(['profile', 'list'], { HOME: home, cwd: projectDir });
      assert.strictEqual(r.status, 0, `stderr: ${r.stderr}`);
      assert.ok(r.stdout.includes('visible'), `stdout: ${r.stdout}`);
      assert.ok(!r.stdout.includes('.hidden'), `hidden dir must not appear in stdout: ${r.stdout}`);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('[cmd] profile list --plain excludes hidden directories', () => {
    const home = mkdtempSync(join(tmpdir(), 'psbx-list-hidden-plain-'));
    try {
      run(['profile', 'init', 'visible', '--self-test'], { HOME: home, cwd: projectDir });
      mkdirSync(join(home, '.psbx', 'profiles', '.hidden'), { recursive: true });
      const r = run(['profile', 'list', '--plain'], { HOME: home, cwd: projectDir });
      assert.strictEqual(r.status, 0, `stderr: ${r.stderr}`);
      assert.ok(r.stdout.includes('visible'), `stdout: ${r.stdout}`);
      assert.ok(!r.stdout.includes('.hidden'), `hidden dir must not appear in stdout: ${r.stdout}`);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  // --- list --prune ---

  it('[cmd] list --prune removes stale entries', () => {
    const home = mkdtempSync(join(tmpdir(), 'psbx-prune-'));
    const project = mkdtempSync(join(tmpdir(), 'psbx-prune-proj-'));
    try {
      run(['profile', 'init', 'self-test', '--self-test'], { HOME: home, cwd: project });
      // Write a registry entry pointing to a non-existent project dir + non-existent VM
      const staleProjectDir = join(tmpdir(), `psbx-nonexistent-${Date.now()}`);
      const configPath = join(home, '.psbx', 'config.json');
      let existing: ConfigFileData = {};
      try {
        existing = JSON.parse(readFileSync(configPath, 'utf-8'));
      } catch {
        existing = {};
      }
      existing.vms = {
        'stale-vm': { projectDir: staleProjectDir, profile: 'self-test' },
      };
      writeFileSync(configPath, `${JSON.stringify(existing, null, 2)}\n`, 'utf-8');

      const fake = writeFakeLimactl({});
      const env = {
        PATH: `${fake.binDir}:${process.env.PATH}`,
        PI_TEST_LIMA_STATE: fake.statePath,
      };

      const r = run(['list', '--prune'], { HOME: home, cwd: project, env });
      assert.strictEqual(r.status, 0, `stderr: ${r.stderr}`);
      assert.ok(r.stdout.includes('Pruned stale entry'), `stdout: ${r.stdout}`);
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(project, { recursive: true, force: true });
    }
  });

  // --- delete --all-registered ---

  it('[cmd] delete --all-registered deletes all registered VMs', () => {
    const home = mkdtempSync(join(tmpdir(), 'psbx-delall-vm-'));
    const project = mkdtempSync(join(tmpdir(), 'psbx-delall-vm-proj-'));
    try {
      run(['profile', 'init', 'self-test', '--self-test'], { HOME: home, cwd: project });
      const vmName = vmNameFrom(project);
      writeRegistry(home, project, { profile: 'self-test' });

      const fake = writeFakeLimactl({
        [vmName]: { name: vmName, status: 'Running', config: {} },
      });
      const env = {
        PATH: `${fake.binDir}:${process.env.PATH}`,
        PI_TEST_LIMA_STATE: fake.statePath,
      };

      const r = run(['-y', 'delete', '--all-registered'], { HOME: home, cwd: project, env });
      assert.strictEqual(r.status, 0, `stderr: ${r.stderr}`);
      assert.ok(
        r.stdout.includes('All registered sandboxes have been deleted'),
        `stdout: ${r.stdout}`,
      );
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(project, { recursive: true, force: true });
    }
  });

  it('[cmd] delete --all-registered reports no sandboxes when registry is empty', () => {
    const r = run(['-y', 'delete', '--all-registered'], { HOME: tmpHome, cwd: projectDir });
    assert.strictEqual(r.status, 0);
    assert.ok(r.stdout.includes('No registered sandboxes to delete'), `stdout: ${r.stdout}`);
  });

  // --- profile fork ---

  it('[cmd] profile fork exits 1 when no registry entry exists for the VM', () => {
    const home = mkdtempSync(join(tmpdir(), 'psbx-fork-noentry-'));
    const project = mkdtempSync(join(tmpdir(), 'psbx-fork-noentry-proj-'));
    try {
      run(['profile', 'init', 'self-test', '--self-test'], { HOME: home, cwd: project });
      // deliberately no writeRegistry call
      const r = run(['profile', 'fork', 'new-profile'], { HOME: home, cwd: project });
      assert.strictEqual(r.status, 1);
      assert.ok(r.stderr.includes('No registry entry'), `stderr: ${r.stderr}`);
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(project, { recursive: true, force: true });
    }
  });

  it('[cmd] profile fork exits 1 when VM is not running', () => {
    const home = mkdtempSync(join(tmpdir(), 'psbx-fork-stopped-'));
    const project = mkdtempSync(join(tmpdir(), 'psbx-fork-stopped-proj-'));
    try {
      run(['profile', 'init', 'self-test', '--self-test'], { HOME: home, cwd: project });
      const vmName = vmNameFrom(project);
      writeRegistry(home, project, { profile: 'self-test' });
      const fake = writeFakeLimactl({
        [vmName]: { name: vmName, status: 'Stopped', config: {} },
      });
      const env = {
        PATH: `${fake.binDir}:${process.env.PATH}`,
        PI_TEST_LIMA_STATE: fake.statePath,
      };
      const r = run(['profile', 'fork', 'new-profile'], { HOME: home, cwd: project, env });
      assert.strictEqual(r.status, 1);
      assert.ok(r.stderr.includes('must be running'), `stderr: ${r.stderr}`);
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(project, { recursive: true, force: true });
    }
  });

  it('[cmd] profile fork creates profile and rebases VM by default', () => {
    const home = mkdtempSync(join(tmpdir(), 'psbx-fork-rebase-'));
    const project = mkdtempSync(join(tmpdir(), 'psbx-fork-rebase-proj-'));
    try {
      run(['profile', 'init', 'self-test', '--self-test'], { HOME: home, cwd: project });
      const vmName = vmNameFrom(project);
      writeRegistry(home, project, { profile: 'self-test' });
      const fake = writeFakeLimactl({
        [vmName]: { name: vmName, status: 'Running', config: {} },
      });
      const env = {
        PATH: `${fake.binDir}:${process.env.PATH}`,
        PI_TEST_LIMA_STATE: fake.statePath,
      };
      const r = run(['profile', 'fork', 'forked'], { HOME: home, cwd: project, env });
      assert.strictEqual(r.status, 0, `stderr: ${r.stderr}`);
      // New profile directory was created
      assert.ok(
        existsSync(join(home, '.psbx', 'profiles', 'forked')),
        'forked profile dir should exist',
      );
      // Registry was rebased onto the new profile
      const cfg = JSON.parse(
        readFileSync(join(home, '.psbx', 'config.json'), 'utf-8'),
      ) as ConfigFileData;
      assert.strictEqual(cfg.vms?.[vmName]?.profile, 'forked');
      assert.ok(r.stdout.includes('Rebased'), `expected 'Rebased' in stdout: ${r.stdout}`);
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(project, { recursive: true, force: true });
    }
  });

  it('[cmd] profile fork --no-rebase creates profile but keeps VM on original profile', () => {
    const home = mkdtempSync(join(tmpdir(), 'psbx-fork-norebase-'));
    const project = mkdtempSync(join(tmpdir(), 'psbx-fork-norebase-proj-'));
    try {
      run(['profile', 'init', 'self-test', '--self-test'], { HOME: home, cwd: project });
      const vmName = vmNameFrom(project);
      writeRegistry(home, project, { profile: 'self-test' });
      const fake = writeFakeLimactl({
        [vmName]: { name: vmName, status: 'Running', config: {} },
      });
      const env = {
        PATH: `${fake.binDir}:${process.env.PATH}`,
        PI_TEST_LIMA_STATE: fake.statePath,
      };
      const r = run(['profile', 'fork', 'forked', '--no-rebase'], {
        HOME: home,
        cwd: project,
        env,
      });
      assert.strictEqual(r.status, 0, `stderr: ${r.stderr}`);
      // New profile directory was created
      assert.ok(
        existsSync(join(home, '.psbx', 'profiles', 'forked')),
        'forked profile dir should exist',
      );
      // Registry still points to the original profile (not rebased)
      const cfg = JSON.parse(
        readFileSync(join(home, '.psbx', 'config.json'), 'utf-8'),
      ) as ConfigFileData;
      assert.strictEqual(cfg.vms?.[vmName]?.profile, 'self-test');
      assert.ok(
        r.stdout.includes('remains on profile'),
        `expected 'remains on profile' in stdout: ${r.stdout}`,
      );
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(project, { recursive: true, force: true });
    }
  });
});
