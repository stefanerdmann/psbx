import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { homedir } from 'node:os';

// ---------------------------------------------------------------------------
// pi-sandbox init
//
// Generates a self-documenting config file at ~/.pi-sandbox/config.json.
// No interactive prompts — the user edits the file themselves.
//
// Also creates the ~/.pi-sandbox/ directory if it doesn't exist and prints
// guidance on what to edit and what files to copy.
// ---------------------------------------------------------------------------

const CONFIG_DIR = resolve(homedir(), '.pi-sandbox');
const CONFIG_PATH = resolve(CONFIG_DIR, 'config.json');

// Default config with all fields. Self-explanatory structure.
const DEFAULT_CONFIG = {
  activeProfile: 'default',
  profiles: {
    default: {
      cert: null,
      pi: {
        configDir: '~/.pi-sandbox'
      },
      mcp: {
        envPassthrough: []
      },
      vm: {
        cpus: 4,
        memory: '8GiB',
        disk: '50GiB'
      }
    }
  }
};

export async function init() {
  // Don't overwrite existing config
  if (existsSync(CONFIG_PATH)) {
    console.log(`Config already exists at ${CONFIG_PATH}`);
    console.log('Edit it directly to change your settings.');
    return;
  }

  // Create directory
  mkdirSync(CONFIG_DIR, { recursive: true });

  // Write config
  writeFileSync(
    CONFIG_PATH,
    JSON.stringify(DEFAULT_CONFIG, null, 2) + '\n',
    'utf-8'
  );

  console.log(`Created ${CONFIG_PATH}`);
  console.log('');
  console.log('Edit the config for your environment:');
  console.log('');
  console.log('  Certificate (corporate proxy):');
  console.log('    Set profiles.default.cert to { "hostBundlePath": "/path/to/ca-bundle.pem" }');
  console.log('    Leave as null if no corporate certificate is needed.');
  console.log('');
  console.log('  Pi agent files:');
  console.log(`    Copy these files to ${CONFIG_DIR}/`);
  console.log('      auth.json      — Your pi authentication tokens (required)');
  console.log('      settings.json  — Pi settings: model, provider, packages (optional)');
  console.log('      mcp.json       — MCP server configuration (optional)');
  console.log('');
  console.log('  MCP token passthrough:');
  console.log('    Add env var names to profiles.default.mcp.envPassthrough');
  console.log('    Example: ["GHE_MCP_TOKEN", "GITHUB_MCP_TOKEN"]');
  console.log('');
  console.log('  VM resources:');
  console.log('    Adjust profiles.default.vm.cpus, memory, disk as needed.');
  console.log('    Defaults: 4 CPUs, 8GiB RAM, 50GiB disk');
  console.log('');
  console.log('  Multiple profiles:');
  console.log('    Add more profiles under "profiles" (e.g., "corporate", "personal").');
  console.log('    Set "activeProfile" to your default, or use --profile flag per command.');
  console.log('');
  console.log('Once configured, run `pi-sandbox create` in any project directory.');
}
