/**
 * Generic, dependency-free helpers shared across the codebase.
 *
 * Intent: keep small, widely-used primitives (error normalization, type
 * guards, byte formatting) in one place so individual modules do not grow
 * private copies and so behavior stays consistent (e.g. how an unknown
 * error is converted to a string).
 */

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Narrow an `unknown` to a plain (non-array, non-null) object. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Expand a leading `~` / `~/` in a string against the given base directory.
 * Non-strings pass through unchanged. Shared by `config.ts#expandHome` (base
 * = host home) and `template.ts#expandGuestHome` (base = guest home).
 */
function expandTilde(filepath: string, base: string): string;
function expandTilde<T>(filepath: T, base: string): T;
function expandTilde(filepath: unknown, base: string): unknown {
  if (typeof filepath !== 'string') return filepath;
  if (filepath === '~') return base;
  if (filepath.startsWith('~/')) return `${base}/${filepath.slice(2)}`;
  return filepath;
}

/** Convert any thrown value into a human-readable message. */
function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Type guard: an Error carrying a specific `code` (e.g. Node's `ENOENT`). */
function hasErrorCode(err: unknown, code: string): err is Error & { code: string } {
  return err instanceof Error && 'code' in err && err.code === code;
}

/**
 * Render a size value for human display. Pass-through for strings (Lima
 * already returns formatted sizes like `"4GiB"`); converts numeric byte
 * counts to a binary-prefix string with one decimal.
 */
function formatBytes(bytes: string | number | null | undefined): string {
  if (bytes === undefined || bytes === null) return 'n/a';
  if (typeof bytes === 'string') return bytes;
  if (typeof bytes !== 'number' || Number.isNaN(bytes)) return 'n/a';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return `${size.toFixed(1)} ${units[i]}`;
}

/**
 * Wrap a string in POSIX single quotes, escaping any embedded single quotes
 * using the standard `'"'"'` idiom so the result is safe to pass through a
 * POSIX shell without interpretation of special characters.
 *
 * Used both when building `limactl shell` arguments and when generating
 * inline shell scripts in finalize.ts.
 */
function shellQuote(s: string): string {
  return `'${String(s).replaceAll("'", "'\"'\"'")}'`;
}

/**
 * Locate the package root directory by walking up from the current module
 * until a directory containing `package.json` is found. Works correctly
 * whether running from source (`src/`) or from compiled output (`dist/src/`).
 */
function packageRoot(): string {
  const start = dirname(fileURLToPath(import.meta.url));
  let dir = start;
  while (true) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    const parent = resolve(dir, '..');
    if (parent === dir) {
      throw new Error(`Could not find package root from ${start}`);
    }
    dir = parent;
  }
}

/**
 * Given a `sessions.workspacePath` value, return the directory path that
 * must be created with `mkdir -p` on both the host and the guest.
 *
 * Semantics (trailing-slash convention):
 *   - Trailing slash  → directory path → create it directly.
 *   - No trailing slash → file path   → create only its parent directory;
 *                                        the file itself is the agent tool's responsibility.
 */
function workspaceMkdirTarget(workspacePath: string): string {
  if (workspacePath.endsWith('/')) {
    return workspacePath;
  }
  const lastSlash = workspacePath.lastIndexOf('/');
  return lastSlash >= 0 ? workspacePath.slice(0, lastSlash) : '.';
}

/**
 * Render a fixed-width text table. Column widths are the max of the header
 * and all cell lengths; cells are left-aligned and joined with two spaces.
 * The final column is not padded (avoids trailing whitespace). Returns the
 * header row followed by each data row, joined by newlines.
 */
function renderTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((header, col) =>
    Math.max(header.length, ...rows.map((row) => (row[col] ?? '').length)),
  );
  const formatRow = (cells: string[]): string =>
    cells
      .map((cell, col) => (col === cells.length - 1 ? cell : cell.padEnd(widths[col])))
      .join('  ');
  return [formatRow(headers), ...rows.map(formatRow)].join('\n');
}

export {
  errorMessage,
  expandTilde,
  formatBytes,
  hasErrorCode,
  isPlainObject,
  packageRoot,
  renderTable,
  shellQuote,
  workspaceMkdirTarget,
};
