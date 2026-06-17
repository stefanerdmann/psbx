import assert from 'node:assert/strict';
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { copyDirWithResolvedSymlinks, renderTable } from '../../src/utils.ts';

describe('renderTable', { concurrency: true }, () => {
  it('pads columns to the max of header and cell widths', () => {
    const out = renderTable(
      ['NAME', 'STATUS'],
      [
        ['vm-a', 'Running'],
        ['longer-name', 'Stopped'],
      ],
    );
    const lines = out.split('\n');
    assert.strictEqual(lines.length, 3);
    // Header NAME column padded to width of 'longer-name'.
    assert.strictEqual(lines[0], 'NAME         STATUS');
    assert.strictEqual(lines[1], 'vm-a         Running');
    assert.strictEqual(lines[2], 'longer-name  Stopped');
  });

  it('does not pad the final column (no trailing whitespace)', () => {
    const out = renderTable(['A', 'B'], [['x', 'y']]);
    for (const line of out.split('\n')) {
      assert.strictEqual(line, line.trimEnd(), `trailing whitespace in: "${line}"`);
    }
  });

  it('renders just the header when there are no rows', () => {
    assert.strictEqual(renderTable(['A', 'B'], []), 'A  B');
  });
});

describe('copyDirWithResolvedSymlinks', { concurrency: true }, () => {
  it('copies a directory tree resolving file symlinks to their targets', () => {
    const base = mkdtempSync(join(tmpdir(), 'psbx-cdrs-'));
    try {
      const realDir = join(base, 'real');
      mkdirSync(realDir);
      writeFileSync(join(realDir, 'file.txt'), 'hello');

      const src = join(base, 'src');
      mkdirSync(src);
      writeFileSync(join(src, 'regular.txt'), 'world');
      symlinkSync(join(realDir, 'file.txt'), join(src, 'link.txt'));

      const dest = join(base, 'dest');
      copyDirWithResolvedSymlinks(src, dest);

      assert.strictEqual(readFileSync(join(dest, 'regular.txt'), 'utf-8'), 'world');
      const linkDestPath = join(dest, 'link.txt');
      assert.ok(
        !lstatSync(linkDestPath).isSymbolicLink(),
        'symlink should be resolved to a real file',
      );
      assert.strictEqual(readFileSync(linkDestPath, 'utf-8'), 'hello');
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('recursively resolves directory symlinks into their contents', () => {
    const base = mkdtempSync(join(tmpdir(), 'psbx-cdrs-'));
    try {
      const realDir = join(base, 'real');
      mkdirSync(realDir);
      writeFileSync(join(realDir, 'inner.txt'), 'inner');

      const src = join(base, 'src');
      mkdirSync(src);
      writeFileSync(join(src, 'top.txt'), 'top');
      symlinkSync(realDir, join(src, 'linked-dir'));

      const dest = join(base, 'dest');
      copyDirWithResolvedSymlinks(src, dest);

      assert.ok(
        !lstatSync(join(dest, 'linked-dir')).isSymbolicLink(),
        'dir symlink should be resolved',
      );
      assert.ok(
        !lstatSync(join(dest, 'linked-dir', 'inner.txt')).isSymbolicLink(),
        'nested file should be real',
      );
      assert.strictEqual(readFileSync(join(dest, 'linked-dir', 'inner.txt'), 'utf-8'), 'inner');
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('preserves restrictive directory modes', () => {
    const base = mkdtempSync(join(tmpdir(), 'psbx-cdrs-'));
    try {
      const src = join(base, 'src');
      mkdirSync(src);
      const secrets = join(src, 'secrets');
      mkdirSync(secrets);
      writeFileSync(join(secrets, 'id'), 'key');
      chmodSync(secrets, 0o700);

      const dest = join(base, 'dest');
      copyDirWithResolvedSymlinks(src, dest);

      assert.strictEqual(statSync(join(dest, 'secrets')).mode & 0o777, 0o700);
      assert.strictEqual(readFileSync(join(dest, 'secrets', 'id'), 'utf-8'), 'key');
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('does not hang on cyclic directory symlinks', () => {
    const base = mkdtempSync(join(tmpdir(), 'psbx-cdrs-'));
    try {
      const src = join(base, 'src');
      mkdirSync(join(src, 'a'), { recursive: true });
      writeFileSync(join(src, 'a', 'file.txt'), 'ok');
      // a/loop points back at src, forming a cycle. cp refuses it (warning)
      // instead of recursing forever.
      symlinkSync(src, join(src, 'a', 'loop'));

      const dest = join(base, 'dest');
      copyDirWithResolvedSymlinks(src, dest);

      assert.strictEqual(readFileSync(join(dest, 'a', 'file.txt'), 'utf-8'), 'ok');
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
