import { dirname, basename } from 'node:path';
import { writeFileSync } from 'node:fs';
import yaml from 'js-yaml';

// ---------------------------------------------------------------------------
// Ubuntu Noble cloud image for aarch64 (ARM).
// This is the standard image Lima uses for Apple Silicon Macs.
// ---------------------------------------------------------------------------

const UBUNTU_IMAGE = {
  location: 'https://cloud-images.ubuntu.com/noble/current/noble-server-cloudimg-arm64.img',
  arch: 'aarch64'
};

// ---------------------------------------------------------------------------
// Build the complete Lima configuration as a JavaScript object.
//
// This replaces the old envsubst-based YAML template approach.
// Every section is built programmatically, so conditional features
// (certs, MCP) are natural JavaScript conditionals — no string templating.
//
// Args:
//   profile  — resolved profile object from config.resolveProfile()
//   projectDir — absolute path to the project directory on the host
// ---------------------------------------------------------------------------

export function buildLimaConfig(profile, projectDir) {
  return {
    vmType: 'vz',
    mountType: 'virtiofs',
    user: { name: 'pi' },
    images: [UBUNTU_IMAGE],
    cpus: profile.vm.cpus,
    memory: profile.vm.memory,
    disk: profile.vm.disk,
    mounts: buildMounts(profile, projectDir),
    provision: buildProvision(profile)
  };
}

// ---------------------------------------------------------------------------
// Build the mounts array.
//
// Always includes:
//   1. Pi config dir (read-only) — host settings, auth, mcp config
//   2. Project dir (writable) — the actual project code at /app
//
// Conditionally includes:
//   3. Certificate dir (read-only) — only if cert.hostBundlePath is configured
// ---------------------------------------------------------------------------

function buildMounts(profile, projectDir) {
  const mounts = [
    {
      location: profile.pi.configDir,
      mountPoint: '/mnt/pi-host-config',
      writable: false
    },
    {
      location: projectDir,
      mountPoint: '/app',
      writable: true
    }
  ];

  // Conditional cert mount: only add if a certificate path is configured.
  // We mount the DIRECTORY containing the cert, not the cert file itself,
  // because Lima mounts directories, not individual files.
  if (profile.cert?.hostBundlePath) {
    mounts.push({
      location: dirname(profile.cert.hostBundlePath),
      mountPoint: '/mnt/host-cert-dir',
      writable: false
    });
  }

  return mounts;
}

// ---------------------------------------------------------------------------
// Build the provision array (system + user scripts).
// ---------------------------------------------------------------------------

function buildProvision(profile) {
  return [
    buildSystemProvision(profile),
    buildUserProvision(profile)
  ];
}

// ---------------------------------------------------------------------------
// System provisioning script (runs as root).
//
// This script installs all system-level dependencies. It runs once when the
// VM is first created. Order matters — each step depends on the previous.
//
// Pitfalls addressed:
//   #1  apt lock race — wait loop before first apt command
//   #2  mount not ready — wait for /mnt/pi-host-config before proceeding
//   #13 multiple cert consumers — update system certs + NODE_EXTRA_CA_CERTS
// ---------------------------------------------------------------------------

export function buildSystemProvision(profile) {
  const hasCert = !!profile.cert?.hostBundlePath;
  const certFileName = hasCert ? basename(profile.cert.hostBundlePath) : null;

  const lines = [
    '#!/bin/bash',
    'set -euo pipefail',
    '',
    '# ── Wait for system readiness ──────────────────────────────────────────',
    '',
    '# Wait until the package manager (apt) is unlocked.',
    '# cloud-init may still hold the lock when provisioning starts (Pitfall #1).',
    'while fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1; do sleep 1; done',
    '',
    '# Wait until the host config mount is available.',
    '# virtiofs mounts may not be ready immediately on fast ARM Macs (Pitfall #2).',
    'until mountpoint -q /mnt/pi-host-config; do sleep 1; done',
  ];

  // ── Certificate injection (conditional) ──
  if (hasCert) {
    lines.push(
      '',
      '# ── Certificate injection ──────────────────────────────────────────────',
      '# Corporate proxy/MITM certs must be trusted by ALL consumers:',
      '# apt, curl, git (use system certs), and Node.js (uses NODE_EXTRA_CA_CERTS).',
      '# We install into the system trust store so apt/curl/git work,',
      '# and set NODE_EXTRA_CA_CERTS in user provisioning for Node.js.',
      '',
      'apt-get update',
      'apt-get install -y ca-certificates',
      `cp /mnt/host-cert-dir/${certFileName} /usr/local/share/ca-certificates/host-cert.crt`,
      'update-ca-certificates',
    );
  }

  // ── Base packages ──
  lines.push(
    '',
    '# ── Base packages ─────────────────────────────────────────────────────',
    '',
    'apt-get update',
    'apt-get install -y curl gnupg git',
  );

  // ── Node.js 22 ──
  lines.push(
    '',
    '# ── Node.js 22 (LTS) ─────────────────────────────────────────────────',
    '# Required by the pi coding agent. Installed via NodeSource.',
    '',
    'curl -fsSL https://deb.nodesource.com/setup_22.x | bash -',
    'apt-get install -y nodejs',
  );

  // ── Pi coding agent ──
  lines.push(
    '',
    '# ── Pi coding agent ──────────────────────────────────────────────────',
    '',
    'npm install -g @mariozechner/pi-coding-agent',
  );

  return {
    mode: 'system',
    script: lines.join('\n') + '\n'
  };
}

// ---------------------------------------------------------------------------
// User provisioning script (runs as the 'pi' user).
//
// Sets up the pi agent config using the "quarantine" strategy:
//   - Read-only data (settings) is copied and patched
//   - Writable data (auth) is copied so the VM manages its own token lifecycle
//   - MCP config is copied if present
//
// This protects host data integrity while giving the VM everything it needs.
//
// Pitfalls addressed:
//   #7  auth token race — copy auth.json, don't symlink
//   #9  env leakage — LIMA_SHELLENV is set by the enter command, not here
// ---------------------------------------------------------------------------

export function buildUserProvision(profile) {
  const hasCert = !!profile.cert?.hostBundlePath;

  const lines = [
    '#!/bin/bash',
    'set -euo pipefail',
    '',
    '# ── Session storage ───────────────────────────────────────────────────',
    '# Pi sessions are stored in the project directory so they survive VM',
    '# deletion. The /app mount is the host project dir (writable).',
    '',
    'mkdir -p /app/.pi-sandbox/sessions',
    '',
    '# ── Pi agent config directory ────────────────────────────────────────',
    '# ~/.pi/agent/ is where the pi agent looks for its configuration.',
    '',
    'mkdir -p ~/.pi/agent',
    '',
    '# ── Settings (copy + patch) ──────────────────────────────────────────',
    '# Copy host settings.json and patch sessionDir to point to the',
    '# project-local session directory. This way the user does not need',
    '# to think about guest paths — sessions just appear in their project.',
    '',
    'if [ -f /mnt/pi-host-config/settings.json ]; then',
    '  node -e "',
    '    const fs = require(\'fs\');',
    '    const settings = JSON.parse(fs.readFileSync(\'/mnt/pi-host-config/settings.json\', \'utf-8\'));',
    '    settings.sessionDir = \'/app/.pi-sandbox/sessions\';',
    '    fs.writeFileSync(process.env.HOME + \'/.pi/agent/settings.json\', JSON.stringify(settings, null, 2));',
    '  "',
    'fi',
    '',
    '# ── Auth tokens (copy, not symlink) ──────────────────────────────────',
    '# Pi needs write access to auth.json for token refresh cycles.',
    '# Symlinking would write back to the host, and multiple VMs could',
    '# race on the same file. Copying decouples each VM\'s auth lifecycle.',
    '',
    'if [ -f /mnt/pi-host-config/auth.json ]; then',
    '  cp /mnt/pi-host-config/auth.json ~/.pi/agent/auth.json',
    '  chmod 600 ~/.pi/agent/auth.json',
    'fi',
    '',
    '# ── MCP config (copy if present) ─────────────────────────────────────',
    '',
    'if [ -f /mnt/pi-host-config/mcp.json ]; then',
    '  cp /mnt/pi-host-config/mcp.json ~/.pi/agent/mcp.json',
    'fi',
    '',
    '# ── npm global prefix ────────────────────────────────────────────────',
    '# Pi installs packages (extensions) globally via npm. Without a user-space',
    '# prefix, npm tries to write to /usr/lib which requires sudo and fails.',
    '',
    'mkdir -p ~/.npm-global',
    'npm config set prefix \'~/.npm-global\'',
    '',
    '# ── Shell environment (.bashrc) ──────────────────────────────────────',
    '',
    '# Add npm global bin to PATH so pi-installed packages are available.',
    'echo \'export PATH="$HOME/.npm-global/bin:$PATH"\' >> ~/.bashrc',
  ];

  // NODE_EXTRA_CA_CERTS — only needed if a corporate cert was installed.
  // This tells Node.js to trust the system cert bundle, which now includes
  // our corporate cert. Without this, Node.js uses its own bundled certs
  // and HTTPS requests through the corporate proxy would fail.
  if (hasCert) {
    lines.push(
      '',
      '# Tell Node.js to use system certificates (includes our corporate cert).',
      'echo \'export NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt\' >> ~/.bashrc',
    );
  }

  lines.push(
    '',
    '# Set default working directory to the mounted project.',
    'echo \'cd /app\' >> ~/.bashrc',
  );

  return {
    mode: 'user',
    script: lines.join('\n') + '\n'
  };
}

// ---------------------------------------------------------------------------
// Serialize the Lima config to YAML.
//
// lineWidth: -1 prevents js-yaml from wrapping long lines, which is critical
// for provisioning scripts — wrapped lines would break the shell scripts.
// ---------------------------------------------------------------------------

export function buildLimaYaml(profile, projectDir) {
  const config = buildLimaConfig(profile, projectDir);
  return yaml.dump(config, {
    lineWidth: -1,
    noRefs: true,
    quotingType: '"'
  });
}

// ---------------------------------------------------------------------------
// Write the Lima YAML to a file.
// Used by the create command to write a temp file before calling limactl.
// ---------------------------------------------------------------------------

export function writeLimaYaml(profile, projectDir, outputPath) {
  const yamlContent = buildLimaYaml(profile, projectDir);
  writeFileSync(outputPath, yamlContent, 'utf-8');
  return outputPath;
}
