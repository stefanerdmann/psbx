import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { shellQuote } from '../../src/lima.ts';

// Verify shellQuote is re-exported from lima.ts (canonical implementation
// and full test coverage lives in utils.ts / finalize.test.ts).
describe('shellQuote (re-export from lima.ts)', { concurrency: true }, () => {
  it('is exported and works correctly', () => {
    assert.strictEqual(shellQuote("it's"), "'it'\"'\"'s'");
  });
});
