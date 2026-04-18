import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { homedir } from 'node:os';

// ---------------------------------------------------------------------------
// VM Registry
//
// Tracks which Lima VMs were created by pi-sandbox and maps them to their
// host project directories. Stored at ~/.pi-sandbox/vms.json.
//
// Format: { "vm-name": "/path/to/project", ... }
//
// This is best-effort — if the file is corrupt or missing, commands still
// work. Only `list` depends on it for display.
// ---------------------------------------------------------------------------

const REGISTRY_PATH = resolve(homedir(), '.pi-sandbox', 'vms.json');

/**
 * Load the registry. Returns {} on missing or corrupt file.
 */
export function loadRegistry() {
  try {
    const raw = readFileSync(REGISTRY_PATH, 'utf-8');
    const data = JSON.parse(raw);
    return typeof data === 'object' && data !== null ? data : {};
  } catch {
    return {};
  }
}

/**
 * Save the registry to disk. Creates directory if needed.
 */
export function saveRegistry(data) {
  try {
    mkdirSync(dirname(REGISTRY_PATH), { recursive: true });
    writeFileSync(REGISTRY_PATH, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  } catch (err) {
    // Best-effort — log but don't break the command
    console.warn(`Warning: Could not save VM registry: ${err.message}`);
  }
}

/**
 * Register a VM after successful creation.
 */
export function registerVm(vmName, projectDir) {
  const registry = loadRegistry();
  registry[vmName] = projectDir;
  saveRegistry(registry);
}

/**
 * Unregister a VM after successful deletion.
 */
export function unregisterVm(vmName) {
  const registry = loadRegistry();
  delete registry[vmName];
  saveRegistry(registry);
}

/**
 * Get the full registry map.
 */
export function getRegistry() {
  return loadRegistry();
}
