import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');

/** Collect every long option flag (`--flag`) registered in bin/psbx.ts. */
function registeredFlags(): Set<string> {
  const src = readFileSync(resolve(ROOT, 'bin', 'psbx.ts'), 'utf-8');
  const flags = new Set<string>();
  for (const match of src.matchAll(/\.option\(\s*'([^']*)'/g)) {
    for (const flag of match[1].matchAll(/--[a-z0-9][a-z0-9-]*/g)) {
      flags.add(flag[0]);
    }
  }
  return flags;
}

/** Collect every long option flag mentioned in the README "## Commands" table. */
function documentedFlags(): string[] {
  const readme = readFileSync(resolve(ROOT, 'README.md'), 'utf-8');
  const start = readme.indexOf('## Commands');
  assert.ok(start >= 0, 'README is missing a "## Commands" section');
  // Limit to the command table itself (up to the global-option note).
  const end = readme.indexOf('Global option:', start);
  const section = readme.slice(start, end >= 0 ? end : undefined);

  const flags = new Set<string>();
  for (const line of section.split('\n')) {
    if (!line.startsWith('|')) continue;
    for (const flag of line.matchAll(/--[a-z0-9][a-z0-9-]*/g)) {
      flags.add(flag[0]);
    }
  }
  return [...flags];
}

// F15: keep the README command/flag table honest — every flag it documents
// must correspond to a real registered commander option.
describe('README command table', () => {
  it('documents only flags that are registered in bin/psbx.ts', () => {
    const registered = registeredFlags();
    const documented = documentedFlags();
    assert.ok(documented.length > 0, 'expected to find documented flags in the README table');

    const unknown = documented.filter((flag) => !registered.has(flag));
    assert.deepStrictEqual(
      unknown,
      [],
      `README documents flags with no matching commander option: ${unknown.join(', ')}`,
    );
  });
});
