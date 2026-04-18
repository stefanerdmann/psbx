import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { loadConfig, resolveProfile, getVmName, deepMerge } from '../config.js';
import { LimaError } from '../lima.js';

// ---------------------------------------------------------------------------
// resolveContext(options)
//
// Common pre-check used by all commands. Loads config, resolves the active
// profile (with optional --profile override), applies project-level overrides
// from .pi-sandbox.json, and derives the VM name from the current directory.
// Returns everything a command needs to get started.
// ---------------------------------------------------------------------------

export function resolveContext(options = {}) {
  const config = loadConfig();
  let profile = resolveProfile(config, options.profile);
  const vmName = getVmName();
  const projectDir = process.cwd();

  // Apply project-level overrides if .pi-sandbox.json exists in the project dir.
  // Only profile fields (vm, cert, pi, mcp) are overridable — not activeProfile
  // or the profiles list.
  try {
    const overridePath = join(projectDir, '.pi-sandbox.json');
    const raw = readFileSync(overridePath, 'utf-8');
    const projectOverrides = JSON.parse(raw);
    profile = deepMerge(profile, projectOverrides);
  } catch {
    // No project overrides — that's normal
  }

  return { config, profile, vmName, projectDir };
}

// ---------------------------------------------------------------------------
// confirm(question)
//
// Readline-based yes/no prompt. Returns true for 'y'/'Y', false otherwise.
// Default is No — empty input returns false.
// ---------------------------------------------------------------------------

export async function confirm(question) {
  const rl = readline.createInterface({ input, output });
  try {
    const answer = await rl.question(question);
    return answer.trim().toLowerCase() === 'y';
  } finally {
    rl.close();
  }
}

// ---------------------------------------------------------------------------
// handleError(err)
//
// Common error handler for all commands. Prints user-friendly messages
// without stack traces. Exits with code 1.
//
// - LimaError: show the Lima-specific message
// - Other Error: show generic "Unexpected error" wrapper
// ---------------------------------------------------------------------------

export function handleError(err) {
  if (err instanceof LimaError) {
    console.error(`Error: ${err.message}`);
  } else if (err instanceof Error) {
    console.error(`Error: ${err.message}`);
  } else {
    console.error('An unexpected error occurred.');
  }
  process.exit(1);
}
