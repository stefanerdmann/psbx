import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// ---------------------------------------------------------------------------
// Config validation
//
// Validates a resolved profile before VM creation. Returns structured
// results with errors (critical, block create) and warnings (non-critical,
// proceed with caution).
//
// Every error/warning is actionable — says what's wrong AND how to fix it.
// ---------------------------------------------------------------------------

/**
 * Validate a resolved profile. Returns { errors: string[], warnings: string[] }.
 * Errors are critical and should block VM creation.
 * Warnings are informational — creation can proceed.
 */
export function validateConfig(profile) {
  const errors = [];
  const warnings = [];

  // ── Critical: limactl must be installed ──
  const limaCheck = spawnSync('limactl', ['--version'], {
    encoding: 'utf-8',
    stdio: 'pipe'
  });
  if (limaCheck.error?.code === 'ENOENT') {
    errors.push(
      'limactl not found. Install Lima first: https://lima-vm.io'
    );
  }

  // ── Critical: certificate file must exist if configured ──
  if (profile.cert?.hostBundlePath) {
    if (!existsSync(profile.cert.hostBundlePath)) {
      errors.push(
        `Certificate not found at ${profile.cert.hostBundlePath}\n` +
        '  Fix: check cert.hostBundlePath in ~/.pi-sandbox/config.json'
      );
    }
  }

  // ── Critical: pi config directory must exist ──
  if (!existsSync(profile.pi.configDir)) {
    errors.push(
      `Pi config directory not found at ${profile.pi.configDir}\n` +
      '  Fix: run `pi-sandbox init` or create it manually'
    );
  } else {
    // ── Critical: auth.json must exist ──
    const authPath = join(profile.pi.configDir, 'auth.json');
    if (!existsSync(authPath)) {
      errors.push(
        `auth.json not found at ${authPath}\n` +
        `  Fix: copy your pi auth tokens to ${profile.pi.configDir}/auth.json`
      );
    }

    // ── Warning: settings.json missing ──
    const settingsPath = join(profile.pi.configDir, 'settings.json');
    if (!existsSync(settingsPath)) {
      warnings.push(
        `settings.json not found at ${settingsPath} — pi will use default settings`
      );
    }

    // ── Warning: mcp.json missing ──
    const mcpPath = join(profile.pi.configDir, 'mcp.json');
    if (!existsSync(mcpPath)) {
      warnings.push(
        `mcp.json not found at ${mcpPath} — no MCP servers will be configured`
      );
    }
  }

  // ── Warning: MCP env vars not set ──
  for (const varName of profile.mcp.envPassthrough) {
    if (!process.env[varName]) {
      warnings.push(
        `Environment variable ${varName} not set — MCP tools may not work in the VM`
      );
    }
  }

  return { errors, warnings };
}

/**
 * Print validation results. Returns true if no errors (ok to proceed).
 */
export function printValidation({ errors, warnings }) {
  for (const warning of warnings) {
    console.warn(`Warning: ${warning}`);
  }

  for (const error of errors) {
    console.error(`Error: ${error}`);
  }

  if (warnings.length > 0 && errors.length === 0) {
    console.log('');
  }

  return errors.length === 0;
}
