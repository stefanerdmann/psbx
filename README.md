# pi-sandbox

A CLI tool that manages per-project [Lima](https://lima-vm.io) VMs for sandboxing the [pi coding agent](https://github.com/mariozechner/pi-coding-agent) on macOS ARM. Each project gets its own isolated VM with the pi agent pre-installed, your project files mounted in, and environment-specific configuration (corporate certs, auth tokens, MCP servers) handled automatically.

## Prerequisites

| Requirement | Install | Why |
|---|---|---|
| **macOS ARM** (Apple Silicon) | — | Uses Lima with Apple Virtualization framework (VZ) |
| **Lima** | `brew install lima` | Manages the lightweight Linux VMs |
| **Node.js ≥ 20** | `brew install node` | Runtime for pi-sandbox and the pi agent |
| **Pi auth tokens** | `auth.json` from your pi agent setup | Authenticates the pi agent inside the VM |

**Corporate environments only:**
- A CA certificate bundle file (`.pem`) for your corporate proxy

## Install

```bash
npm install -g pi-sandbox
```

## Quick Start

### 1. Initialize configuration

```bash
pi-sandbox init
```

This creates `~/.pi-sandbox/config.json` with sensible defaults and prints guidance on what to edit.

### 2. Configure for your environment

Edit `~/.pi-sandbox/config.json`:

```json
{
  "activeProfile": "default",
  "profiles": {
    "default": {
      "cert": null,
      "pi": { "configDir": "~/.pi-sandbox" },
      "mcp": { "envPassthrough": [] },
      "vm": { "cpus": 4, "memory": "8GiB", "disk": "50GiB" }
    }
  }
}
```

**Corporate setup** — set the certificate path and MCP tokens:
```json
{
  "activeProfile": "corporate",
  "profiles": {
    "corporate": {
      "cert": { "hostBundlePath": "~/certs/corporate-ca.pem" },
      "mcp": { "envPassthrough": ["GHE_MCP_TOKEN", "GITHUB_MCP_TOKEN"] },
      "vm": { "cpus": 4, "memory": "8GiB", "disk": "50GiB" }
    }
  }
}
```

### 3. Copy pi agent files

Copy your pi agent configuration files to the config directory:

```bash
cp ~/.pi/agent/auth.json ~/.pi-sandbox/auth.json        # Required
cp ~/.pi/agent/settings.json ~/.pi-sandbox/settings.json  # Optional
cp ~/.pi/agent/mcp.json ~/.pi-sandbox/mcp.json            # Optional
```

### 4. Create a sandbox

```bash
cd ~/projects/my-project
pi-sandbox create
```

This provisions a Lima VM with:
- Your project directory mounted at `/app` (writable)
- Pi agent installed and configured
- Auth tokens, settings, and MCP config from your host
- Corporate certificate injected (if configured)

### 5. Start working

```bash
pi-sandbox enter
```

You're now inside the VM at `/app` with the pi agent ready to use. Your MCP tokens are available. Run `pi` to start a session.

## Commands

| Command | Description | Flags |
|---|---|---|
| `pi-sandbox init` | Create config file with defaults | — |
| `pi-sandbox create` | Provision a new VM for current project | `--profile <name>` |
| `pi-sandbox enter` | Enter VM shell (auto-starts if stopped) | `--profile <name>` |
| `pi-sandbox start` | Start a stopped VM | `--profile <name>` |
| `pi-sandbox stop` | Stop a running VM | `--profile <name>` |
| `pi-sandbox delete` | Delete VM (prompts for confirmation) | `--profile <name>` |
| `pi-sandbox recreate` | Delete + create (applies config changes) | `--profile <name>` |
| `pi-sandbox status` | Show VM status for current project | — |
| `pi-sandbox list` | List all pi-sandbox VMs | — |
| `pi-sandbox logs` | Show VM provisioning logs | — |

## Common Workflows

### Switch between profiles

```bash
# Use corporate profile for this project
pi-sandbox create --profile corporate

# Or set the default in config
# "activeProfile": "corporate"
```

### Apply config changes

VM configuration is baked in at creation time. To apply changes:

```bash
pi-sandbox recreate
```

This deletes the VM and creates a fresh one. **Session data is preserved** — it lives in your project directory at `.pi-sandbox/sessions/`, not inside the VM.

### Project-level overrides

Create `.pi-sandbox.json` in your project directory to override settings for that project only:

```json
{
  "vm": { "cpus": 8, "memory": "16GiB" }
}
```

This merges over your user config. Useful for giving resource-intensive projects more power.

### Check what's running

```bash
# Current project
pi-sandbox status

# All sandboxes
pi-sandbox list
```

### Debug provisioning failures

```bash
pi-sandbox logs
```

Shows the cloud-init output log from inside the VM — useful when `create` fails during provisioning.

## Session Data

Pi session data is stored at `<project-dir>/.pi-sandbox/sessions/`. Consider adding `.pi-sandbox/` to your project's `.gitignore`:

```bash
echo '.pi-sandbox/' >> .gitignore
```

## Troubleshooting

### `Error: limactl not found`

Lima is not installed. Install it:
```bash
brew install lima
```

### `Error: auth.json not found`

Copy your pi auth tokens to the config directory:
```bash
cp ~/.pi/agent/auth.json ~/.pi-sandbox/auth.json
```

### `Error: Certificate not found at ...`

The configured certificate path doesn't exist. Check `cert.hostBundlePath` in `~/.pi-sandbox/config.json`. If you don't need corporate certs, set `cert` to `null`.

### `Warning: Environment variable X not set`

MCP tokens aren't set in your shell. Export them before running pi-sandbox:
```bash
export GHE_MCP_TOKEN="your-token"
export GITHUB_MCP_TOKEN="your-token"
```

Add these to your `~/.zshrc` to make them persistent.

### VM name collision

Two projects with the same directory name (e.g., both named `app`) will collide. Rename one of the directories.

## Further Reading

- [Configuration Reference](docs/CONFIG.md) — complete config schema
- [Architecture](docs/ARCHITECTURE.md) — design patterns and rationale
- [Provisioning](docs/PROVISIONING.md) — what happens inside the VM and why
