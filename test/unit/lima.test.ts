import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { shellCommandArgs, shellQuote } from '../../src/lima.ts';

// Verify shellQuote is re-exported from lima.ts (canonical implementation
// and full test coverage lives in utils.ts / finalize.test.ts).
describe('shellQuote (re-export from lima.ts)', { concurrency: true }, () => {
  it('is exported and works correctly', () => {
    assert.strictEqual(shellQuote("it's"), "'it'\"'\"'s'");
  });
});

// F1/F3: limaShell builds its in-guest argv from shellCommandArgs.
describe('shellCommandArgs', { concurrency: true }, () => {
  it('returns an empty argv for an empty command (interactive shell)', () => {
    assert.deepStrictEqual(shellCommandArgs([]), []);
  });

  it('quotes each token so multi-word commands are parsed by bash', () => {
    const args = shellCommandArgs(['npm', 'run', 'build']);
    assert.deepStrictEqual(args, ['bash', '-i', '-c', "'npm' 'run' 'build'"]);
  });

  it('preserves argument boundaries for arguments containing spaces', () => {
    const args = shellCommandArgs(['echo', 'a b']);
    assert.deepStrictEqual(args, ['bash', '-i', '-c', "'echo' 'a b'"]);
  });

  it('does not collapse a single multi-word string into one command name', () => {
    // Regression: the old code quoted command.join(' '), producing
    // 'npm run build' as a single (non-existent) command name.
    const payload = shellCommandArgs(['npm', 'run', 'build'])[3];
    assert.notStrictEqual(payload, "'npm run build'");
  });
});
