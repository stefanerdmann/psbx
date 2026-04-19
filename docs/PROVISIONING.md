# Provisioning Deep-Dive

This document walks through every provisioning script block, explaining what it does, WHY it exists, and what would break without it. Read this before modifying the templates in `templates/` or debugging a failed VM creation.

## Overview

When `pi-sandbox create` runs, it generates a Lima YAML config containing two provisioning scripts:

1. **System provisioning** — runs as `root`, installs system packages and certificates
2. **User provisioning** — runs as the `pi` user, sets up the pi agent environment

Both scripts live as Handlebars template files in the `templates/` directory:

1. **`templates/provision-system.sh.hbs`** — runs as `root`, installs system packages and certificates
2. **`templates/provision-user.sh.hbs`** — runs as the `pi` user, sets up the pi agent environment

`src/template.js` renders these templates with values from the user's config profile. Conditional sections (certificate handling) use `{{#if cert}}...{{/if}}` Handlebars syntax — open the template files and the conditionals are immediately visible.

**Provisioning runs once**, at VM creation. There is no way to re-run provisioning on an existing VM. To apply changes, use `pi-sandbox recreate` (which deletes and rebuilds the VM).

## System Provisioning

Runs as `root`. Installs system-level dependencies.

### `set -euo pipefail`

```bash
set -euo pipefail
```

**What:** Enables strict error handling.
- `-e` — exit immediately if any command fails
- `-u` — treat unset variables as errors
- `-o pipefail` — a pipeline fails if any command in it fails (not just the last)

**Why:** Without this, a failed `apt-get install` would be silently ignored, and later steps that depend on the package would fail with confusing errors. Fail-fast surfaces the real problem.

**Trade-off:** A non-critical failure (e.g., a package already installed) could abort the script. In practice, `apt-get install -y` handles "already installed" gracefully and returns 0.

### apt lock wait

```bash
while fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1; do sleep 1; done
```

**What:** Waits until no process holds the apt package manager lock.

**Why (Pitfall #1):** When Lima creates the VM, cloud-init starts running background tasks (like `unattended-upgrades`) that hold the apt lock. Our provisioning script runs concurrently. Without this wait, `apt-get` fails with:

```
E: Could not get lock /var/lib/dpkg/lock-frontend
```

**How it works:** `fuser` checks if any process has the lock file open. If it returns 0 (some process has it), we sleep and retry. When it returns non-zero (nobody has it), we proceed.

### Mount readiness wait

```bash
until mountpoint -q /mnt/pi-host-config; do sleep 1; done
```

**What:** Waits until the host config directory is mounted and accessible.

**Why (Pitfall #2):** On fast ARM Macs, the virtiofs mount may not be available when the provisioning script starts. The mount is set up asynchronously by Lima. Without this wait, the user provisioning script (which reads files from the mount) would fail with "file not found."

**How it works:** `mountpoint -q` checks if a path is a mount point. Returns 0 when the mount is active.

### Certificate injection (conditional)

*Only present when `profile.cert.hostBundlePath` is configured.*

```bash
apt-get update
apt-get install -y ca-certificates
cp /mnt/host-cert-dir/corporate-ca.pem /usr/local/share/ca-certificates/host-cert.crt
update-ca-certificates
```

**What:** Installs the corporate CA certificate into the system trust store.

**Why:** Corporate proxies intercept HTTPS traffic and re-sign it with a corporate CA. Without trusting this CA:
- `apt-get update` fails (can't verify package repos)
- `git clone` over HTTPS fails
- `curl` fails
- Essentially, nothing that uses HTTPS works

**How it works:**
1. `ca-certificates` package provides the `/usr/local/share/ca-certificates/` directory and the `update-ca-certificates` tool
2. Copying the cert to that directory with a `.crt` extension registers it
3. `update-ca-certificates` rebuilds `/etc/ssl/certs/ca-certificates.crt` (the system bundle) to include our cert

**Why the cert is mounted from a directory, not the file:** Lima mounts directories, not individual files. The cert file's parent directory is mounted at `/mnt/host-cert-dir/` (read-only). The cert filename is dynamic (varies per machine), resolved from the config.

**Symlink warning:** The `hostBundlePath` in the config must be the real file path, not a symlink. Lima mounts the parent directory of the configured path. If that path is a symlink, the parent directory of the symlink is mounted — not the parent directory of the symlink's target. The actual cert file won't be in the mount. Use `realpath <path>` to resolve symlinks before putting the path in the config.

**What breaks without it:** All HTTPS-dependent operations fail in the VM when behind a corporate proxy.

### Base packages

```bash
apt-get update
apt-get install -y curl gnupg git
```

**What:** Installs essential tools.

**Why each package:**
- `curl` — needed to download the NodeSource setup script
- `gnupg` — needed by NodeSource setup to verify GPG keys for the Node.js apt repository
- `git` — needed by the pi agent for version control operations

### Node.js 22

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs
```

**What:** Installs Node.js 22 (LTS) from NodeSource.

**Why Node.js 22:** The pi coding agent requires Node.js. Version 22 is the current LTS release with long-term support.

**Why NodeSource (not Ubuntu's default Node.js):** Ubuntu Noble ships an older Node.js version that doesn't meet pi's requirements. NodeSource provides up-to-date releases.

**Note:** The exact Node.js 22.x patch version depends on when the VM is created. Different VMs created at different times may have different patch versions. This is acceptable — the pi agent doesn't depend on specific patch versions.

### Pi coding agent

```bash
npm install -g @mariozechner/pi-coding-agent
```

**What:** Installs the pi coding agent globally.

**Why global:** The `pi` command must be available from any directory in the VM. Global npm install puts it on the system PATH.

---

## User Provisioning

Runs as the `pi` user. Sets up the pi agent configuration and shell environment.

### Session directory

```bash
mkdir -p /app/.pi-sandbox/sessions
```

**What:** Creates the directory where pi stores session data.

**Why `/app/.pi-sandbox/sessions/`:** The `/app` mount is the host project directory (writable). Storing sessions here means they persist on the host and survive VM deletion. See [Architecture — Session Storage](ARCHITECTURE.md#session-storage).

**Why `mkdir -p`:** Creates the directory and any parents. Safe to run if it already exists (idempotent).

### Pi agent config directory

```bash
mkdir -p ~/.pi/agent
```

**What:** Creates the directory where the pi agent looks for its configuration.

**Why `~/.pi/agent/`:** This is the pi agent's standard config location. The agent looks here for `auth.json`, `settings.json`, and `mcp.json`.

### Settings copy + patch

```bash
if [ -f /mnt/pi-host-config/settings.json ]; then
  node -e "
    const fs = require('fs');
    const settings = JSON.parse(fs.readFileSync('/mnt/pi-host-config/settings.json', 'utf-8'));
    settings.sessionDir = '/app/.pi-sandbox/sessions';
    fs.writeFileSync(process.env.HOME + '/.pi/agent/settings.json', JSON.stringify(settings, null, 2));
  "
fi
```

**What:** Copies the host's `settings.json` and changes `sessionDir` to point to the project-local session directory.

**Why not just copy:** The host's `settings.json` has `sessionDir` set to a host-relevant path. Inside the VM, sessions must go to `/app/.pi-sandbox/sessions` so they persist in the project directory. We need to modify exactly one field while preserving all other settings (model preferences, packages, etc.).

**Why an inline `node -e` script:** Shell tools like `sed` or `jq` would require additional dependencies or fragile regex. Node.js is already installed (from system provisioning) and handles JSON natively. The inline script is self-contained and easy to understand.

**Why conditional (`if [ -f ... ]`):** `settings.json` is optional. If the user hasn't provided one, pi uses its built-in defaults. The validation step warns about this but doesn't block creation.

### Auth token copy

```bash
if [ -f /mnt/pi-host-config/auth.json ]; then
  cp /mnt/pi-host-config/auth.json ~/.pi/agent/auth.json
  chmod 600 ~/.pi/agent/auth.json
fi
```

**What:** Copies the auth tokens and restricts file permissions.

**Why copy (not symlink):** This is the **auth quarantine pattern**. The pi agent refreshes tokens during operation, which requires write access. If auth.json were a symlink:
- Writes would go through to the host's master copy (the mount is read-only, so this would actually fail)
- Even if the mount were writable, multiple VMs would race on the same file
- A corrupted token could break all VMs simultaneously

Copying gives each VM its own independent authentication lifecycle. See [Architecture — Auth Quarantine](ARCHITECTURE.md#auth-quarantine-pattern).

**Why `chmod 600`:** Auth tokens are secrets. Restricting to owner-read-write prevents other users in the VM from reading them. Defense in depth — the VM is single-user, but it's good practice.

### MCP config copy

```bash
if [ -f /mnt/pi-host-config/mcp.json ]; then
  cp /mnt/pi-host-config/mcp.json ~/.pi/agent/mcp.json
fi
```

**What:** Copies MCP server configuration if present.

**Why copy:** Keeps the pattern consistent with auth.json. The mount is read-only, so the agent can't modify the host copy even if it wanted to.

**Why conditional:** MCP configuration is optional. Without it, the pi agent works but has no MCP tool access. The validation step warns about this.

### npm global prefix

```bash
mkdir -p ~/.npm-global
npm config set prefix '~/.npm-global'
```

**What:** Redirects global npm installs to a user-writable directory.

**Why this is necessary:** The pi agent installs extensions and packages globally via `npm install -g`. Without this setting, npm tries to write to `/usr/lib/node_modules/`, which requires root. The agent runs as the `pi` user (not root), so the install fails with:

```
EACCES: permission denied, mkdir '/usr/lib/node_modules/@somepackage'
```

Setting a user-space prefix redirects global installs to `~/.npm-global/`, which the `pi` user owns.

### PATH update

```bash
echo 'export PATH="$HOME/.npm-global/bin:$PATH"' >> ~/.bashrc
```

**What:** Adds the npm global bin directory to PATH.

**Why:** After setting the npm prefix to `~/.npm-global`, globally installed packages put their executables in `~/.npm-global/bin/`. Without this PATH addition, those executables aren't found:

```
pi: command not found  # Even though pi-coding-agent is installed
```

**Why `.bashrc`:** This runs on every new shell session, ensuring the PATH is always correct when you `pi-sandbox enter`.

### NODE_EXTRA_CA_CERTS (conditional)

*Only present when `profile.cert.hostBundlePath` is configured.*

```bash
echo 'export NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt' >> ~/.bashrc
```

**What:** Tells Node.js to use the system certificate bundle.

**Why:** Node.js does NOT use the system trust store by default. It ships its own bundled Mozilla certificates. Even though we installed our corporate CA into the system trust store (in system provisioning), Node.js ignores it. Without this env var:
- `npm install` fails behind a corporate proxy
- The pi agent can't reach model providers
- Any Node.js HTTPS request fails with `UNABLE_TO_VERIFY_LEAF_SIGNATURE`

**Why only when cert is configured:** Personal Macs without corporate proxies don't need this. Node.js's built-in Mozilla certs work fine for public HTTPS endpoints.

**Why `/etc/ssl/certs/ca-certificates.crt`:** This is the consolidated system cert bundle that `update-ca-certificates` builds. It includes both the standard CA certs and our corporate cert.

### Working directory

```bash
echo 'cd /app' >> ~/.bashrc
```

**What:** Sets the default working directory to the project mount.

**Why:** When you `pi-sandbox enter`, you land in the VM's home directory (`/home/pi.linux/`). The project files are at `/app`. This saves the user from typing `cd /app` every time they enter the VM.

---

## Conditional Behavior Summary

What changes in the provisioning scripts depending on configuration:

| Config state | System provisioning | User provisioning |
|---|---|---|
| `cert` configured | Includes cert copy + update-ca-certificates | Includes `NODE_EXTRA_CA_CERTS` in .bashrc |
| `cert` is null | Skips cert section entirely | Skips `NODE_EXTRA_CA_CERTS` |
| `settings.json` exists on host | — | Copies + patches sessionDir |
| `settings.json` missing | — | Skips (pi uses built-in defaults) |
| `mcp.json` exists on host | — | Copies to guest |
| `mcp.json` missing | — | Skips (no MCP servers) |
| `auth.json` exists on host | — | Copies with chmod 600 |
| `auth.json` missing | **Validation blocks create** | — |

## Re-provisioning

Lima runs provisioning scripts once, at VM creation time. There is no built-in way to re-run them on an existing VM.

**To apply configuration changes:**

```bash
pi-sandbox recreate
```

This deletes the VM and creates a fresh one from the current config. Session data survives because it lives in the project directory, not inside the VM.

**Why Lima doesn't support re-provisioning:** Lima VMs are designed to be disposable. The provisioning scripts are embedded in the VM's cloud-init config, which runs on first boot only. Changing this behavior would require modifying cloud-init's instance state, which is fragile and unsupported.
