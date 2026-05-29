/**
 * Standalone preflight diagnostics. Surfaces the checks that otherwise only
 * run implicitly inside `up` (Lima presence/version via `validate.ts`,
 * default profile, per-profile `env.yaml` validity) plus which
 * `shellEnvAllowlist` variables are currently unset in the invoking shell.
 *
 * Exits non-zero when a hard problem is found (Lima missing/too old or an
 * invalid `env.yaml`); unset allowlist variables are reported as warnings.
 */

export const DESCRIPTION = 'Diagnose the psbx setup (Lima, profiles, env allowlist)';

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { getProfilesDir, loadConfig, loadEnv } from '../config.ts';
import { limaVersion } from '../lima.ts';
import type { EnvConfig } from '../types.ts';
import { errorMessage } from '../utils.ts';
import { isVersionAtLeast, MIN_LIMA_VERSION, parseLimaVersion } from '../validate.ts';
import { handleError } from './helpers.ts';

const OK = '✓';
const FAIL = '✗';
const WARN = '!';

function listProfileNames(): string[] {
  const dir = getProfilesDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort();
}

/** Report Lima presence and version. Returns the number of hard problems. */
function checkLima(): number {
  console.log('Lima:');
  let versionString: string | null = null;
  try {
    versionString = limaVersion();
  } catch (err: unknown) {
    console.log(`  ${FAIL} ${errorMessage(err)}`);
    return 1;
  }

  const version = parseLimaVersion(versionString);
  if (!version) {
    console.log(`  ${WARN} limactl found but its version could not be parsed ("${versionString}")`);
    return 0;
  }
  if (!isVersionAtLeast(version, MIN_LIMA_VERSION)) {
    console.log(`  ${FAIL} Lima ${version} is too old (minimum ${MIN_LIMA_VERSION})`);
    return 1;
  }
  console.log(`  ${OK} limactl ${version} (minimum ${MIN_LIMA_VERSION})`);
  return 0;
}

/** Report the configured default profile. */
function checkDefaultProfile(defaultProfile: string | null, profiles: string[]): number {
  console.log('Default profile:');
  if (!defaultProfile) {
    console.log(`  ${WARN} none configured (set one with \`psbx profile set-default <name>\`)`);
    return 0;
  }
  if (!profiles.includes(defaultProfile)) {
    console.log(`  ${FAIL} default profile "${defaultProfile}" does not exist`);
    return 1;
  }
  console.log(`  ${OK} ${defaultProfile}`);
  return 0;
}

/** Validate each profile's env.yaml and report unset allowlist variables. */
function checkProfiles(profiles: string[]): number {
  console.log('Profiles:');
  if (profiles.length === 0) {
    console.log(`  ${WARN} no profiles found (create one with \`psbx profile init <name>\`)`);
    return 0;
  }

  let problems = 0;
  for (const name of profiles) {
    let env: EnvConfig;
    try {
      env = loadEnv(join(getProfilesDir(), name));
    } catch (err: unknown) {
      console.log(`  ${FAIL} ${name} — invalid env.yaml: ${errorMessage(err)}`);
      problems++;
      continue;
    }

    console.log(`  ${OK} ${name} — env.yaml valid`);
    const unset = (env.shellEnvAllowlist || []).filter((v) => !process.env[v]);
    if (unset.length > 0) {
      console.log(`      ${WARN} unset allowlist vars: ${unset.join(', ')}`);
    }
  }
  return problems;
}

export async function doctor(): Promise<void> {
  try {
    const config = loadConfig();
    const profiles = listProfileNames();

    let problems = 0;
    problems += checkLima();
    console.log('');
    problems += checkDefaultProfile(config.defaultProfile, profiles);
    console.log('');
    problems += checkProfiles(profiles);

    console.log('');
    if (problems === 0) {
      console.log(`${OK} No problems detected.`);
    } else {
      console.log(`${FAIL} ${problems} problem(s) detected.`);
      process.exitCode = 1;
    }
  } catch (err: unknown) {
    handleError(err);
  }
}
