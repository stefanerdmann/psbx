import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeCacheEntry, normalizeEntry } from '../../src/registry.ts';
import type { CacheEntry, RegistryEntry } from '../../src/types.ts';

// ---------------------------------------------------------------------------
// normalizeEntry
// ---------------------------------------------------------------------------

describe('normalizeEntry', { concurrency: true }, () => {
  it('normalizes a valid entry', () => {
    const result = normalizeEntry({
      projectDir: '/home/user/project',
      profile: 'default',
      finalizerStatus: 'done',
      limaConfigHash: 'abc123',
    }) as RegistryEntry;
    assert.strictEqual(result.projectDir, '/home/user/project');
    assert.strictEqual(result.profile, 'default');
    assert.strictEqual(result.finalizerStatus, 'done');
    assert.strictEqual(result.limaConfigHash, 'abc123');
  });

  it('returns null for null input', () => {
    assert.strictEqual(normalizeEntry(null), null);
  });

  it('returns null for non-object input', () => {
    assert.strictEqual(normalizeEntry('string'), null);
    assert.strictEqual(normalizeEntry(42), null);
  });

  it('sets profile to null when missing', () => {
    const result = normalizeEntry({ projectDir: '/path' }) as RegistryEntry;
    assert.strictEqual(result.profile, null);
  });

  it('preserves optional hash fields when present', () => {
    const result = normalizeEntry({
      projectDir: '/path',
      finalizerHash: 'h1',
      shellEnvAllowlistHash: 'h2',
      defaultCmdHash: 'h3',
      profileCacheName: 'pc1',
      profileCacheKey: 'pk1',
    });
    assert.strictEqual(result.finalizerHash, 'h1');
    assert.strictEqual(result.shellEnvAllowlistHash, 'h2');
    assert.strictEqual(result.defaultCmdHash, 'h3');
    assert.strictEqual(result.profileCacheName, 'pc1');
    assert.strictEqual(result.profileCacheKey, 'pk1');
  });

  it('omits optional fields when not present', () => {
    const result = normalizeEntry({ projectDir: '/path' });
    assert.strictEqual(result.finalizerHash, undefined);
    assert.strictEqual(result.profileCacheName, undefined);
  });
});

// ---------------------------------------------------------------------------
// normalizeCacheEntry
// ---------------------------------------------------------------------------

describe('normalizeCacheEntry', { concurrency: true }, () => {
  it('normalizes a valid cache entry', () => {
    const result = normalizeCacheEntry({
      profile: 'default',
      cacheKey: 'abc123',
      limaVersion: '2.1.0',
      createdAt: '2026-01-01T00:00:00Z',
    }) as CacheEntry;
    assert.strictEqual(result.profile, 'default');
    assert.strictEqual(result.cacheKey, 'abc123');
    assert.strictEqual(result.limaVersion, '2.1.0');
    assert.strictEqual(result.createdAt, '2026-01-01T00:00:00Z');
  });

  it('returns null for null input', () => {
    assert.strictEqual(normalizeCacheEntry(null), null);
  });

  it('returns null for non-object input', () => {
    assert.strictEqual(normalizeCacheEntry('string'), null);
  });

  it('returns null when profile is missing', () => {
    assert.strictEqual(normalizeCacheEntry({ cacheKey: 'abc' }), null);
  });

  it('returns null when cacheKey is missing', () => {
    assert.strictEqual(normalizeCacheEntry({ profile: 'default' }), null);
  });

  it('returns null when profile is empty string', () => {
    assert.strictEqual(normalizeCacheEntry({ profile: '', cacheKey: 'abc' }), null);
  });

  it('defaults limaVersion and createdAt to null', () => {
    const result = normalizeCacheEntry({ profile: 'default', cacheKey: 'abc' }) as CacheEntry;
    assert.strictEqual(result.limaVersion, null);
    assert.strictEqual(result.createdAt, null);
  });
});
