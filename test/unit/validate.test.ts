import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import type { ValidationResult } from '../../src/types.ts';

import {
  findCacheUnsafePath,
  isVersionAtLeast,
  parseLimaVersion,
  validateConfig,
} from '../../src/validate.ts';

// ---------------------------------------------------------------------------
// parseLimaVersion
// ---------------------------------------------------------------------------

describe('parseLimaVersion', { concurrency: true }, () => {
  it('extracts semver from limactl output', () => {
    assert.strictEqual(parseLimaVersion('limactl version 2.1.0'), '2.1.0');
  });

  it('handles plain version string', () => {
    assert.strictEqual(parseLimaVersion('2.0.3'), '2.0.3');
  });

  it('returns null for empty/missing version', () => {
    assert.strictEqual(parseLimaVersion(''), null);
    assert.strictEqual(parseLimaVersion(null), null);
    assert.strictEqual(parseLimaVersion(undefined), null);
  });

  it('returns null for non-semver strings', () => {
    assert.strictEqual(parseLimaVersion('no version here'), null);
  });

  it('extracts first match from multi-version string', () => {
    assert.strictEqual(parseLimaVersion('v2.1.0 (commit abc)'), '2.1.0');
  });
});

// ---------------------------------------------------------------------------
// isVersionAtLeast
// ---------------------------------------------------------------------------

describe('isVersionAtLeast', { concurrency: true }, () => {
  it('returns true when version equals minimum', () => {
    assert.strictEqual(isVersionAtLeast('2.0.3', '2.0.3'), true);
  });

  it('returns true when version exceeds minimum', () => {
    assert.strictEqual(isVersionAtLeast('2.1.0', '2.0.3'), true);
  });

  it('returns false when version is below minimum', () => {
    assert.strictEqual(isVersionAtLeast('1.9.9', '2.0.3'), false);
  });

  it('compares major versions correctly', () => {
    assert.strictEqual(isVersionAtLeast('3.0.0', '2.9.9'), true);
    assert.strictEqual(isVersionAtLeast('1.0.0', '2.0.0'), false);
  });

  it('compares minor versions correctly', () => {
    assert.strictEqual(isVersionAtLeast('2.1.0', '2.0.9'), true);
    assert.strictEqual(isVersionAtLeast('2.0.0', '2.1.0'), false);
  });

  it('compares patch versions correctly', () => {
    assert.strictEqual(isVersionAtLeast('2.0.4', '2.0.3'), true);
    assert.strictEqual(isVersionAtLeast('2.0.2', '2.0.3'), false);
  });
});

// ---------------------------------------------------------------------------
// findCacheUnsafePath
// ---------------------------------------------------------------------------

describe('findCacheUnsafePath', { concurrency: true }, () => {
  it('returns the matching path when content references a cache-unsafe path', () => {
    const result = findCacheUnsafePath('cp /home/pi/workdir/file /tmp', [
      '/home/pi/workdir',
      '/mnt/host-config/agent',
    ]);
    assert.strictEqual(result, '/home/pi/workdir');
  });

  it('returns undefined when no unsafe paths are found', () => {
    const result = findCacheUnsafePath('echo hello', [
      '/home/pi/workdir',
      '/mnt/host-config/agent',
    ]);
    assert.strictEqual(result, undefined);
  });

  it('matches config mount paths', () => {
    const result = findCacheUnsafePath('cat /mnt/host-config/agent/settings.json', [
      '/home/pi/workdir',
      '/mnt/host-config/agent',
    ]);
    assert.strictEqual(result, '/mnt/host-config/agent');
  });
});

// ---------------------------------------------------------------------------
// validateConfig (migrated from static.test.js)
// ---------------------------------------------------------------------------

describe('validateConfig', { concurrency: false }, () => {
  it('rejects provisioning scripts that depend on dynamic mounts', () => {
    const profileDir = mkdtempSync(join(tmpdir(), 'pi-cache-unsafe-profile-'));
    const projectDir = mkdtempSync(join(tmpdir(), 'pi-cache-unsafe-project-'));
    try {
      const provisionPath = join(profileDir, 'provision-user.sh');
      writeFileSync(
        join(profileDir, 'lima.yaml'),
        [
          'user:',
          '  name: pi',
          '  home: /home/pi',
          'provision:',
          '  - mode: user',
          '    file: ./provision-user.sh',
          '',
        ].join('\n'),
      );
      writeFileSync(provisionPath, '#!/bin/sh\ncp /mnt/host-config/agent/settings.json /tmp\n');
      const validation: ValidationResult = validateConfig(
        {
          name: 'cache-unsafe',
          dir: profileDir,
          limaPath: join(profileDir, 'lima.yaml'),
          shellEnvAllowlist: [],
          configMounts: [
            {
              source: 'pi/agent',
              name: 'agent',
              guestTarget: '~/.pi/agent',
            },
          ],
        },
        projectDir,
      );
      assert.ok(
        validation.errors.some((error) => error.includes('profile cache provisioning')),
        `expected cache-safety error in ${JSON.stringify(validation.errors)}`,
      );
    } finally {
      rmSync(profileDir, { recursive: true, force: true });
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it('rejects inline provisioning scripts that depend on dynamic mounts', () => {
    const profileDir = mkdtempSync(join(tmpdir(), 'pi-cache-unsafe-inline-profile-'));
    const projectDir = mkdtempSync(join(tmpdir(), 'pi-cache-unsafe-inline-project-'));
    try {
      writeFileSync(
        join(profileDir, 'lima.yaml'),
        [
          'user:',
          '  name: pi',
          '  home: /home/pi',
          'provision:',
          '  - mode: user',
          '    script: |',
          '      ls /home/pi/workdir',
          '',
        ].join('\n'),
      );
      const validation: ValidationResult = validateConfig(
        {
          name: 'cache-unsafe-inline',
          dir: profileDir,
          limaPath: join(profileDir, 'lima.yaml'),
          shellEnvAllowlist: [],
          configMounts: [],
        },
        projectDir,
      );
      assert.ok(
        validation.errors.some((error) => error.includes('Inline provisioning script')),
        `expected inline cache-safety error in ${JSON.stringify(validation.errors)}`,
      );
    } finally {
      rmSync(profileDir, { recursive: true, force: true });
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
});
