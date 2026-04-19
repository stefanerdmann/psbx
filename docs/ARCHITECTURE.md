# Architecture

This document explains the design patterns in pi-sandbox and the rationale behind each. Read this when you need to understand WHY something is built the way it is, or before making changes to the mount strategy, provisioning, or configuration system.

## Component Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     CLI Layer                                │
│  bin/pi-sandbox.js                                           │
│  Commander.js routes commands → handler functions            │
│  --profile flag on lifecycle commands                        │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                   Command Handlers                           │
│  src/commands/{create,enter,start,stop,delete,recreate,      │
│               status,list,logs,init}.js                      │
│  Orchestrate: config → validate → lima → template            │
└───────┬──────────┬───────────┬──────────┬───────────────────┘
        │          │           │          │
┌───────▼───┐ ┌───▼──────┐ ┌──▼─────┐ ┌──▼─────────┐
│  Config   │ │ Validate │ │  Lima  │ │  Template  │
│           │ │          │ │        │ │  Builder   │
│ Load      │ │ Check    │ │ Wrap   │ │ Build Lima │
│ Merge     │ │ paths,   │ │ lima-  │ │ YAML from  │
│ Resolve   │ │ deps,    │ │ ctl    │ │ JS objects │
│ profiles  │ │ env vars │ │ calls  │ │ + config   │
└───────────┘ └──────────┘ └────────┘ └────────────┘
```

Each module has a single responsibility:
- **config.js** — Load config, merge defaults, resolve profiles, derive VM names
- **validate.js** — Check that a profile's paths and dependencies exist before VM creation
- **lima.js** — Thin wrapper around `limactl` subprocess calls with error handling
- **template.js** — Render Handlebars templates into Lima YAML from a resolved profile
- **registry.js** — Track which VMs belong to pi-sandbox (for `list` command)

## YAML Generation: Handlebars Templates

### Problem

The original prototype used a YAML template with `${VAR}` placeholders, processed by `envsubst`. This had no support for conditionals — the cert mount was always present even without a cert, causing Lima errors. Missing env vars produced invalid YAML.

### Solution

Three Handlebars template files that look like real YAML/shell with minimal template syntax:

```
templates/
  lima.yaml.hbs              # Lima VM config — mounts, resources, images
  provision-system.sh.hbs    # Root provisioning script
  provision-user.sh.hbs      # User provisioning script
```

`src/template.js` reads these templates, renders them with Handlebars using values from the resolved config profile, and returns the final Lima YAML string.

### Rendering flow

```
1. Render provision-system.sh.hbs  → system provisioning script string
2. Render provision-user.sh.hbs   → user provisioning script string
3. Indent both scripts (6 spaces for YAML block scalar embedding)
4. Render lima.yaml.hbs           → final Lima YAML (receives scripts as context)
```

### Why Handlebars

- **Readable:** Templates look like the actual Lima YAML / shell scripts. Open `templates/lima.yaml.hbs` and you immediately see the VM configuration.
- **Conditionals:** `{{#if cert}}...{{/if}}` handles optional cert mounts and provisioning blocks cleanly.
- **No arbitrary code:** Unlike EJS, Handlebars doesn't allow arbitrary JavaScript in templates. The template is declarative — logic stays in template.js.
- **Standard:** Handlebars is the most widely used template engine for this pattern. Well-documented, stable.

### Template syntax used

| Syntax | Purpose | Example |
|---|---|---|
| `{{variable}}` | Value substitution | `cpus: {{vm.cpus}}` |
| `{{#if x}}...{{/if}}` | Conditional block | Cert mount, cert provisioning |
| `{{{triple}}}` | Raw output (no escaping) | Embedded provisioning scripts |

### What breaks if changed

- Removing the templates and going back to JS string building makes the Lima config opaque again — you'd need to read JavaScript to understand what the VM gets.
- The `envsubst` approach from the original prototype lacks conditionals and produces invalid YAML on missing variables.
- EJS would work but mixes JavaScript logic into templates, reducing readability.

## Mount Strategy

### Problem

The VM needs access to host files (project code, pi config, certificates) but shouldn't be able to modify host configuration arbitrarily. Different files need different access levels.

### Solution

Three mounts with explicit access control (plus a conditional fourth):

```
HOST                                    GUEST               ACCESS
─────────────────────────────────────────────────────────────────────
~/.pi-sandbox/                    →     /mnt/pi-host-config  Read-only
<project-dir>/                    →     /app                 Read-write
<cert-dir>/  (if cert configured) →     /mnt/host-cert-dir   Read-only
```

### Host directory layout

```
~/.pi-sandbox/
├── config.json          # Tool config (profiles, VM settings)
├── auth.json            # Pi auth tokens (copied to guest)
├── settings.json        # Pi settings (copied + patched in guest)
├── mcp.json             # MCP server config (copied to guest)
└── vms.json             # VM registry (name → project dir)
```

### Guest directory layout

```
/app/                         # Project files (host project dir, writable)
├── .pi-sandbox/
│   └── sessions/             # Pi session data (persists on host)
/mnt/pi-host-config/          # Host pi config (read-only mount)
├── auth.json
├── settings.json
├── mcp.json
/mnt/host-cert-dir/           # Host cert dir (read-only, conditional)
├── corporate-ca.pem
~/.pi/agent/                  # Assembled pi config (built during provisioning)
├── auth.json                 # Copied from mount (writable for token refresh)
├── settings.json             # Copied + patched from mount (sessionDir changed)
├── mcp.json                  # Copied from mount
~/.npm-global/                # User-space npm prefix
├── bin/                      # Global npm binaries on PATH
```

### Why pi config is read-only

If the mount were writable, the pi agent could modify host files during operation. Multiple VMs sharing the same host directory could corrupt each other's settings. The read-only mount enforces the host as the single source of truth — files are copied into the VM during provisioning with explicit handling for each.

### Why project dir is writable

The project directory is the developer's workspace. Code changes, session data, and generated files must persist on the host. The writable mount makes the VM transparent — files modified inside the VM appear on the host immediately.

### What breaks if changed

- Making pi config writable → auth token refresh in VM writes to host → multiple VMs corrupt `auth.json`
- Making project read-only → can't create session directory, can't write code, agent is useless
- Removing the cert mount → corporate proxy blocks all HTTPS in the VM

## Auth Quarantine Pattern

### Problem

The pi agent needs three configuration files (`auth.json`, `settings.json`, `mcp.json`), but each has different access requirements:

| File | Pi agent needs... | Problem if symlinked from host |
|---|---|---|
| `auth.json` | Read + **Write** (token refresh) | Writes go to host; multiple VMs race on the same file |
| `settings.json` | Read only, but needs **modification** (sessionDir) | Can't modify a symlink to a read-only mount |
| `mcp.json` | Read only | No problem, but we copy for consistency |

### Solution: Copy everything, with file-specific handling

During user provisioning:

1. **`settings.json`** — Copy from mount, patch `sessionDir` to `/app/.pi-sandbox/sessions`, write to `~/.pi/agent/settings.json`. Uses an inline `node -e` script to parse JSON, modify the field, and write it back.

2. **`auth.json`** — Copy from mount to `~/.pi/agent/auth.json`, `chmod 600`. The pi agent can now refresh tokens freely without affecting the host file or other VMs.

3. **`mcp.json`** — Copy from mount if present. Simple file copy.

### Why not symlink auth.json

The pi agent refreshes authentication tokens during operation. If `auth.json` were a symlink to the host file:
- Token refresh would write through the symlink to the host's master copy
- Two VMs running simultaneously would race on token refresh
- A corrupted token could break all VMs at once

Copying decouples each VM's authentication lifecycle from the host and from other VMs.

### Why patch settings.json instead of symlinking

The host's `settings.json` has `sessionDir` pointing to a host-relevant path (or the original `/pi/data/sessions`). Inside the VM, sessions must go to `/app/.pi-sandbox/sessions` so they persist in the project directory. We can't symlink because:
1. The mount is read-only — can't modify the file (pi needs to lock settings.json)
2. We need to change `sessionDir` — can't do that with a symlink

The copy+patch approach reads the host's settings, changes one field, and writes it to the VM's config directory.

### What breaks if changed

- Symlink auth.json → token refresh corrupts host file, multi-VM race condition
- Symlink settings.json → can't patch sessionDir, sessions stored in wrong location
- Skip mcp.json → no MCP servers available in the VM

## Certificate Injection

### Problem

Corporate proxies intercept HTTPS traffic and re-sign it with a corporate CA certificate. Every tool that makes HTTPS requests must trust this corporate CA, or connections fail with certificate errors. Different tools use different cert stores:

| Tool | Certificate source |
|---|---|
| apt, curl, git, wget | System trust store (`/etc/ssl/certs/`) |
| Node.js, npm | `NODE_EXTRA_CA_CERTS` env var (or built-in Mozilla certs) |

### Solution: Two-layer approach

**System provisioning (as root):**
1. Copy the corporate CA cert to `/usr/local/share/ca-certificates/host-cert.crt`
2. Run `update-ca-certificates` to add it to the system trust store

This covers apt, curl, git, and any other tool that uses the system cert store.

**User provisioning (as pi user):**
1. Add `export NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt` to `.bashrc`

This tells Node.js to use the system cert bundle (which now includes the corporate CA) instead of its built-in Mozilla certs.

### Why BOTH are needed

- **Without system certs:** `apt-get update` fails (can't verify package repository certs), `git clone` over HTTPS fails, `curl` fails. The VM can't install packages.
- **Without NODE_EXTRA_CA_CERTS:** `npm install` fails, the pi agent can't download packages or communicate with model providers. Node.js ignores the system cert store by default.

### Why it's conditional

Personal Macs don't have corporate proxies. When `cert` is `null` in the config:
- No cert directory is mounted
- No cert copy/update-ca-certificates in system provisioning
- No `NODE_EXTRA_CA_CERTS` in user provisioning

This keeps personal VMs clean — fewer mount points, faster provisioning, no unnecessary env vars.

### What breaks if changed

- Skip system cert update → apt, git, curl all fail behind corporate proxy
- Skip NODE_EXTRA_CA_CERTS → npm, pi agent fail behind corporate proxy
- Make cert conditional logic wrong → corporate VMs missing certs, or personal VMs with unnecessary cert env

## Environment Variable Passthrough

### Problem

MCP bearer tokens (e.g., `GHE_MCP_TOKEN`, `GITHUB_MCP_TOKEN`) live in the host shell environment and must reach the guest VM. But Lima's default behavior forwards ALL host environment variables to the guest, which:
- Leaks secrets the VM doesn't need
- Causes PATH conflicts (host macOS paths vs guest Linux paths)
- Makes the VM environment unpredictable

### Solution: Blanket block + selective allow

When `pi-sandbox enter` runs, it sets:

```bash
LIMA_SHELLENV_BLOCK=*                              # Block everything
LIMA_SHELLENV_ALLOW=GHE_MCP_TOKEN, GITHUB_MCP_TOKEN  # Allow only these
```

The allow-list comes from `profile.mcp.envPassthrough` in the config.

### Why blanket block

Without `LIMA_SHELLENV_BLOCK=*`, Lima forwards your entire host environment. This means:
- `PATH` includes macOS paths like `/opt/homebrew/bin` that don't exist in the Linux guest
- Secrets like `AWS_SECRET_ACCESS_KEY` or other tokens leak into the VM
- Environment is different depending on what's set in the host shell — non-reproducible

The blanket block makes the VM environment clean and predictable. Only explicitly allowed variables pass through.

### How the enter command wires it

```js
// src/lima.js — limaShell()
const env = {
  LIMA_SHELLENV_BLOCK: '*',
  LIMA_SHELLENV_ALLOW: envPassthrough.join(', ')
};
spawnSync('limactl', ['shell', '--preserve-env', '--workdir=/app', name], {
  stdio: 'inherit',
  env: { ...process.env, ...env }
});
```

The `--preserve-env` flag tells Lima to forward environment (subject to the block/allow filters). The env vars are set on the limactl process itself, not inside the VM.

### What breaks if changed

- Remove LIMA_SHELLENV_BLOCK → all host env vars leak into VM
- Remove LIMA_SHELLENV_ALLOW → MCP tokens don't reach the VM, MCP tools fail
- Set allow-list wrong → wrong tokens passed, MCP auth failures

## Session Storage

### Problem

Pi session data (conversation history, context) is valuable. The original prototype stored sessions inside the VM at `/pi/data/sessions`. If you deleted or recreated the VM, all session history was lost.

### Solution: Store sessions in the project directory

Sessions go to `/app/.pi-sandbox/sessions/` in the guest, which maps to `<project-dir>/.pi-sandbox/sessions/` on the host.

During provisioning, the host `settings.json` is copied and patched: `sessionDir` is changed to `/app/.pi-sandbox/sessions`.

### Why the project directory (not a central location)

Sessions are contextual to the project. Storing them alongside the code they relate to:
- Makes them easy to find
- Keeps them associated with the project if you move or share it
- Avoids a growing central session store that's hard to clean up
- Means no additional mount is needed — the project dir is already mounted writable

### Why copy+patch settings.json

The host's `settings.json` may have `sessionDir` set to a path that makes sense on the host (e.g., `/pi/data/sessions` from the original prototype). Inside the VM, we need it to point to `/app/.pi-sandbox/sessions`. Rather than requiring the user to set a guest-aware path in their host config, we copy and patch automatically during provisioning.

### What breaks if changed

- Store sessions inside VM → lost on `pi-sandbox delete` or `recreate`
- Store in central host location → need additional mount, sessions disconnected from project
- Skip sessionDir patching → sessions written to default location inside VM (lost on delete)

## VM Registry

The registry at `~/.pi-sandbox/vms.json` maps VM names to project directories:

```json
{
  "myproject": "/Users/me/projects/myproject",
  "other-app": "/Users/me/projects/other-app"
}
```

### Why it exists

Lima doesn't know which VMs were created by pi-sandbox vs other Lima VMs. The registry lets `pi-sandbox list` show only pi-sandbox VMs and include the project directory path (which Lima doesn't track).

### Best-effort design

The registry is maintained by `create` (adds entry) and `delete` (removes entry). It's deliberately best-effort:
- If the file is corrupt or missing, commands still work — only `list` is affected
- If a VM is deleted outside pi-sandbox (via `limactl delete`), the registry entry becomes stale — `list` shows "Unknown" status
- No locking — concurrent access is unlikely and the worst case is a stale entry
