import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { loadConfig, resolveProfile, getVmName } from '../config.js';
import { LimaError } from '../lima.js';

// ---------------------------------------------------------------------------
// resolveContext()
//
// Common pre-check used by all commands. Loads config, resolves the active
// profile, and derives the VM name from the current directory.
// Returns everything a command needs to get started.
// ---------------------------------------------------------------------------

export function resolveContext() {
  const config = loadConfig();
  const profile = resolveProfile(config);
  const vmName = getVmName();
  const projectDir = process.cwd();
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
