import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { renderTable } from '../../src/utils.ts';

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
