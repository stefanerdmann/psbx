import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { upHint } from '../../src/commands/status.ts';
import { formatBytes } from '../../src/utils.ts';

// ---------------------------------------------------------------------------
// formatBytes
// ---------------------------------------------------------------------------

describe('formatBytes', { concurrency: true }, () => {
  it('formats bytes to human-readable', () => {
    const formatted: string = formatBytes(0);
    assert.strictEqual(formatted, '0.0 B');
  });

  it('formats kilobytes', () => {
    assert.strictEqual(formatBytes(1024), '1.0 KB');
  });

  it('formats megabytes', () => {
    assert.strictEqual(formatBytes(1024 * 1024), '1.0 MB');
  });

  it('formats gigabytes', () => {
    assert.strictEqual(formatBytes(1024 * 1024 * 1024), '1.0 GB');
  });

  it('passes through Lima string sizes directly', () => {
    assert.strictEqual(formatBytes('4GiB'), '4GiB');
    assert.strictEqual(formatBytes('512MiB'), '512MiB');
  });

  it('returns n/a for null', () => {
    assert.strictEqual(formatBytes(null), 'n/a');
  });

  it('returns n/a for undefined', () => {
    assert.strictEqual(formatBytes(undefined), 'n/a');
  });

  it('returns n/a for NaN', () => {
    assert.strictEqual(formatBytes(Number.NaN), 'n/a');
  });
});

// ---------------------------------------------------------------------------
// upHint
// ---------------------------------------------------------------------------

describe('upHint', { concurrency: true }, () => {
  it('returns bare command when profile is the default', () => {
    const hint: string = upHint('default', 'default');
    assert.strictEqual(hint, '`psbx up`');
  });

  it('includes --profile when profile differs from default', () => {
    assert.strictEqual(upHint('custom', 'default'), '`psbx up --profile custom`');
  });

  it('returns bare command when profileName is null', () => {
    assert.strictEqual(upHint(null, 'default'), '`psbx up`');
  });

  it('returns bare command when profileName is undefined', () => {
    assert.strictEqual(upHint(undefined, 'default'), '`psbx up`');
  });
});
