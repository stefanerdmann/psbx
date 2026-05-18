import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import YAML from 'yaml';

import {
  buildCacheLimaConfig,
  buildLimaConfig,
  buildProjectInstanceLimaYaml,
  expandGuestHome,
  GUEST_HOME,
  HOST_CONFIG_BASE,
  loadProjectOverride,
  mountPointFor,
} from '../../src/template.ts';

// ---------------------------------------------------------------------------
// expandGuestHome
// ---------------------------------------------------------------------------

describe('expandGuestHome', { concurrency: true }, () => {
  it('replaces bare ~ with guest home', () => {
    assert.strictEqual(expandGuestHome('~'), GUEST_HOME);
  });

  it('replaces ~/ prefix with guest home', () => {
    assert.strictEqual(expandGuestHome('~/foo/bar'), `${GUEST_HOME}/foo/bar`);
  });

  it('passes through absolute paths', () => {
    assert.strictEqual(expandGuestHome('/etc/config'), '/etc/config');
  });

  it('returns non-string values unchanged', () => {
    assert.strictEqual(expandGuestHome(undefined), undefined);
    assert.strictEqual(expandGuestHome(null), null);
    assert.strictEqual(expandGuestHome(42), 42);
  });
});

// ---------------------------------------------------------------------------
// mountPointFor
// ---------------------------------------------------------------------------

describe('mountPointFor', { concurrency: true }, () => {
  it('returns /mnt/host-config/<name>', () => {
    assert.strictEqual(mountPointFor({ name: 'agent' }), `${HOST_CONFIG_BASE}/agent`);
  });

  it('works with dotted names', () => {
    assert.strictEqual(mountPointFor({ name: 'my.config' }), `${HOST_CONFIG_BASE}/my.config`);
  });
});

// ---------------------------------------------------------------------------
// loadProjectOverride
// ---------------------------------------------------------------------------

describe('loadProjectOverride', { concurrency: true }, () => {
  it('returns empty object when override file does not exist', () => {
    const dir = mkdtempSync(join(tmpdir(), 'psbx-override-'));
    try {
      assert.deepStrictEqual(loadProjectOverride(dir), {});
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('parses valid override keys', () => {
    const dir = mkdtempSync(join(tmpdir(), 'psbx-override-'));
    try {
      mkdirSync(join(dir, '.psbx'), { recursive: true });
      writeFileSync(join(dir, '.psbx', 'lima.yaml'), 'cpus: 4\nmemory: 8GiB\n');
      const override = loadProjectOverride(dir);
      assert.strictEqual(override.cpus, 4);
      assert.strictEqual(override.memory, '8GiB');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects unsupported keys', () => {
    const dir = mkdtempSync(join(tmpdir(), 'psbx-override-'));
    try {
      mkdirSync(join(dir, '.psbx'), { recursive: true });
      writeFileSync(join(dir, '.psbx', 'lima.yaml'), 'cpus: 4\nimages: []\n');
      assert.throws(() => loadProjectOverride(dir), /Unsupported key/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects non-integer cpus', () => {
    const dir = mkdtempSync(join(tmpdir(), 'psbx-override-'));
    try {
      mkdirSync(join(dir, '.psbx'), { recursive: true });
      writeFileSync(join(dir, '.psbx', 'lima.yaml'), 'cpus: 1.5\n');
      assert.throws(() => loadProjectOverride(dir), /positive integer/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects invalid memory format', () => {
    const dir = mkdtempSync(join(tmpdir(), 'psbx-override-'));
    try {
      mkdirSync(join(dir, '.psbx'), { recursive: true });
      writeFileSync(join(dir, '.psbx', 'lima.yaml'), 'memory: lots\n');
      assert.throws(() => loadProjectOverride(dir), /Lima size string/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// buildLimaConfig / buildCacheLimaConfig / buildProjectInstanceLimaYaml
// (migrated from static.test.js)
// ---------------------------------------------------------------------------

import type { SpawnSyncReturns } from 'node:child_process';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveProfile } from '../../src/config.ts';
import type { LimaConfig, LimaMount, Profile } from '../../src/types.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BIN = resolve(__dirname, '..', '..', 'bin', 'psbx.ts');

type RunOptions = {
  HOME?: string;
  cwd?: string;
  input?: string;
  timeout?: number;
  env?: Record<string, string>;
};

type RenderProfile = Pick<Profile, 'name' | 'dir' | 'limaPath' | 'configMounts'>;
type InstanceProfile = Pick<Profile, 'name' | 'dir' | 'configMounts'>;
type MountedLimaConfig = LimaConfig & { mounts: LimaMount[] };
type ParsedInstanceConfig = MountedLimaConfig & {
  base?: string;
  images?: Array<{ location: string; digest?: string }>;
  provision: Array<{ script?: string; file?: string }>;
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

describe('buildLimaConfig', { concurrency: false }, () => {
  it('mounts each profile config subfolder under /mnt/host-config/<name>', () => {
    const home = mkdtempSync(join(tmpdir(), 'psbx-mounts-home-'));
    const proj = mkdtempSync(join(tmpdir(), 'psbx-mounts-proj-'));
    const origHome = process.env.HOME;
    try {
      const r = run(['profile', 'init', 'co', '--template', 'copilot-in-ubuntu'], {
        HOME: home,
        cwd: proj,
      });
      assert.strictEqual(r.status, 0, `stderr: ${r.stderr}`);

      process.env.HOME = home;
      const profile = resolveProfile({ defaultProfile: 'co' }, 'co');
      const config = buildLimaConfig(profile, proj) as MountedLimaConfig;
      const mountPoints = config.mounts.map((m) => m.mountPoint).sort();
      assert.ok(mountPoints.includes('/mnt/host-config/copilot'), `mounts: ${mountPoints}`);
      assert.ok(
        mountPoints.includes('/home/pi/workdir'),
        `expected workdir mount, got: ${mountPoints}`,
      );
      assert.ok(
        !mountPoints.some((p) => p.startsWith('/mnt/psbx-host-config')),
        `legacy mount still present: ${mountPoints}`,
      );
    } finally {
      process.env.HOME = origHome;
      rmSync(home, { recursive: true, force: true });
      rmSync(proj, { recursive: true, force: true });
    }
  });

  it('buildCacheLimaConfig excludes project and profile config dynamic mounts', () => {
    const profileDir = mkdtempSync(join(tmpdir(), 'psbx-cache-profile-'));
    const projectDir = mkdtempSync(join(tmpdir(), 'psbx-cache-project-'));
    try {
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
      writeFileSync(join(profileDir, 'provision-system.sh'), '#!/bin/sh\ntrue\n');
      mkdirSync(join(profileDir, 'pi', 'agent'), { recursive: true });
      const profile: RenderProfile = {
        name: 'cache-test',
        dir: profileDir,
        limaPath: join(profileDir, 'lima.yaml'),
        configMounts: [
          {
            source: 'pi/agent',
            name: 'agent',
            guestTarget: '~/.pi/agent',
            projectSessionDir: '.agents/sessions',
          },
        ],
      };

      const cacheConfig = buildCacheLimaConfig(profile, projectDir) as LimaConfig;
      const fullConfig = buildLimaConfig(profile, projectDir) as MountedLimaConfig;
      assert.ok(
        !Array.isArray(cacheConfig.mounts) ||
          !cacheConfig.mounts.some((m) =>
            ['/home/pi/workdir', '/mnt/host-config/agent'].includes(m.mountPoint),
          ),
        `cache mounts should not contain dynamic project/profile mounts: ${JSON.stringify(cacheConfig.mounts)}`,
      );
      assert.ok(fullConfig.mounts.some((m) => m.mountPoint === '/home/pi/workdir'));
      assert.ok(fullConfig.mounts.some((m) => m.mountPoint === '/mnt/host-config/agent'));
    } finally {
      rmSync(profileDir, { recursive: true, force: true });
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it('buildProjectInstanceLimaYaml preserves expanded instance fields while adding dynamic mounts', () => {
    const profileDir = mkdtempSync(join(tmpdir(), 'psbx-instance-profile-'));
    const projectDir = mkdtempSync(join(tmpdir(), 'psbx-instance-project-'));
    try {
      const configDir = join(profileDir, 'copilot');
      mkdirSync(configDir, { recursive: true });
      const instanceYaml = [
        'user:',
        '  name: pi',
        '  home: /home/pi',
        'images:',
        '  - location: https://example.test/ubuntu.img',
        '    digest: "sha256:abc"',
        'provision:',
        '  - mode: system',
        '    script: |',
        '      echo cache',
        'mounts:',
        '  - location: /cache-only',
        '    mountPoint: /cache-only',
        '    writable: false',
        '',
      ].join('\n');
      const profile: InstanceProfile = {
        name: 'instance-test',
        dir: profileDir,
        configMounts: [
          {
            source: 'copilot',
            name: 'copilot',
            guestTarget: '~/.copilot',
          },
        ],
      };

      const config = YAML.parse(
        buildProjectInstanceLimaYaml(instanceYaml, profile, projectDir),
      ) as ParsedInstanceConfig;
      assert.strictEqual(config.base, undefined);
      assert.deepStrictEqual(config.images, [
        { location: 'https://example.test/ubuntu.img', digest: 'sha256:abc' },
      ]);
      assert.strictEqual(config.provision[0].script.trim(), 'echo cache');
      assert.strictEqual(config.provision[0].file, undefined);

      const mounts = new Map(config.mounts.map((mount) => [mount.mountPoint, mount]));
      assert.strictEqual(mounts.get('/cache-only').location, '/cache-only');
      assert.strictEqual(mounts.get('/home/pi/workdir').location, projectDir);
      assert.strictEqual(mounts.get('/mnt/host-config/copilot').location, realpathSync(configDir));
    } finally {
      rmSync(profileDir, { recursive: true, force: true });
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
});
