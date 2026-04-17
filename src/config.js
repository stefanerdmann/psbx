import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { homedir } from 'node:os';

// ---------------------------------------------------------------------------
// Default configuration
// Every field has a sensible default. The tool works with minimal user config
// — just set activeProfile and override what differs from defaults.
// ---------------------------------------------------------------------------

const DEFAULTS = {
  activeProfile: 'default',
  profiles: {
    default: {
      // Certificate config. null = no corporate cert handling.
      // Set to { hostBundlePath: "/path/to/cacert.pem" } to enable.
      cert: null,

      // Pi agent host config directory.
      // Contains: auth.json, settings.json, mcp.json
      pi: {
        configDir: '~/.pi-sandbox'
      },

      // MCP token passthrough. Environment variables listed here are
      // forwarded from host to guest via LIMA_SHELLENV_ALLOW.
      // Empty array = no MCP token passthrough.
      mcp: {
        envPassthrough: []
      },

      // Lima VM resource allocation.
      vm: {
        cpus: 4,
        memory: '8GiB',
        disk: '50GiB'
      }
    }
  }
};

// ---------------------------------------------------------------------------
// Deep merge utility
// Objects merge recursively, primitives and arrays override.
// ---------------------------------------------------------------------------

function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const targetVal = target[key];
    const sourceVal = source[key];
    if (
      sourceVal !== null &&
      typeof sourceVal === 'object' &&
      !Array.isArray(sourceVal) &&
      targetVal !== null &&
      typeof targetVal === 'object' &&
      !Array.isArray(targetVal)
    ) {
      result[key] = deepMerge(targetVal, sourceVal);
    } else {
      result[key] = sourceVal;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Path resolution
// Expands ~ to the user's home directory.
// ---------------------------------------------------------------------------

function expandHome(filepath) {
  if (filepath.startsWith('~/') || filepath === '~') {
    return filepath.replace('~', homedir());
  }
  return filepath;
}

// ---------------------------------------------------------------------------
// Config loading
// Reads ~/.pi-sandbox/config.json if it exists, merges with DEFAULTS.
// ---------------------------------------------------------------------------

const CONFIG_PATH = resolve(homedir(), '.pi-sandbox', 'config.json');

export function loadConfig() {
  let userConfig = {};
  try {
    const raw = readFileSync(CONFIG_PATH, 'utf-8');
    userConfig = JSON.parse(raw);
  } catch (err) {
    // Config file doesn't exist or is invalid — use defaults.
    // This is normal for first-time users before running `init`.
    if (err.code !== 'ENOENT') {
      console.warn(`Warning: Could not parse ${CONFIG_PATH}: ${err.message}`);
      console.warn('Using default configuration.');
    }
  }
  return deepMerge(DEFAULTS, userConfig);
}

// ---------------------------------------------------------------------------
// Profile resolution
// Looks up the active profile, merges with the default profile, and resolves
// paths (~ expansion).
// ---------------------------------------------------------------------------

export function resolveProfile(config) {
  const profileName = config.activeProfile || 'default';
  const defaultProfile = DEFAULTS.profiles.default;
  const userProfile = config.profiles?.[profileName];

  if (!userProfile) {
    throw new Error(
      `Profile "${profileName}" not found in config. ` +
      `Available profiles: ${Object.keys(config.profiles || {}).join(', ')}`
    );
  }

  // Merge: default profile values ← user profile values
  const merged = deepMerge(defaultProfile, userProfile);

  // Resolve ~ in paths
  merged.pi.configDir = expandHome(merged.pi.configDir);

  if (merged.cert?.hostBundlePath) {
    merged.cert.hostBundlePath = expandHome(merged.cert.hostBundlePath);
  }

  return merged;
}

// ---------------------------------------------------------------------------
// VM naming
// Derives VM name from current working directory.
// Sanitizes: lowercase, non-alphanumeric → hyphens, trim hyphens.
// ---------------------------------------------------------------------------

export function getVmName(dir) {
  const base = basename(dir || process.cwd());
  const sanitized = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (!sanitized) {
    throw new Error(
      `Cannot derive VM name from directory "${base}". ` +
      'Please use a directory name with at least one alphanumeric character.'
    );
  }

  return sanitized;
}

// ---------------------------------------------------------------------------
// Exports for testing / internal use
// ---------------------------------------------------------------------------

export { DEFAULTS, deepMerge, expandHome, CONFIG_PATH };
