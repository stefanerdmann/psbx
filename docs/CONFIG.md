# Configuration Reference

## Config File Location

```
~/.pi-sandbox/config.json
```

Created by `pi-sandbox init`. If the file doesn't exist, pi-sandbox uses built-in defaults.

## Config Layering

Configuration is resolved in three layers, with later layers overriding earlier ones:

```
┌─────────────────────────────┐
│  3. Project overrides       │  .pi-sandbox.json in project dir (highest priority)
├─────────────────────────────┤
│  2. User config             │  ~/.pi-sandbox/config.json
├─────────────────────────────┤
│  1. Built-in defaults       │  Hardcoded in the tool (lowest priority)
└─────────────────────────────┘
```

**How merging works:** Deep merge — objects merge recursively, primitives and arrays replace entirely. This means you only need to specify values that differ from defaults.

## Schema Reference

### `activeProfile`

| Property | Value |
|---|---|
| **Type** | `string` |
| **Default** | `"default"` |
| **Required** | No |

The name of the profile to use when no `--profile` flag is provided. Must match a key in `profiles`.

**Why it exists:** Lets you set a default environment (e.g., "corporate") while still being able to switch with `--profile personal` on individual commands.

---

### `profiles`

A map of named profiles. Each profile contains all environment-specific settings.

**Why profiles exist:** Different environments (corporate Mac with proxy certs, personal Mac without) need different configurations. Rather than maintaining separate config files, profiles let you keep everything in one file and switch between them.

---

### `profiles.<name>.cert`

| Property | Value |
|---|---|
| **Type** | `object \| null` |
| **Default** | `null` |
| **Required** | No |

Certificate configuration for corporate proxy environments. Set to `null` (or omit entirely) if you don't need corporate certificate injection.

**Why nullable:** Personal Macs don't have corporate proxies. When `null`, the entire certificate injection flow is skipped — no cert mount, no cert provisioning, no `NODE_EXTRA_CA_CERTS`. This keeps personal VMs clean and faster to provision.

---

### `profiles.<name>.cert.hostBundlePath`

| Property | Value |
|---|---|
| **Type** | `string` |
| **Default** | — |
| **Required** | Yes (if `cert` is not null) |

Absolute path to the CA certificate bundle file on the host. Supports `~` expansion.

**Example:** `"~/certs/corporate-ca.pem"` or `"/opt/certs/ca-bundle.pem"`

**Validation:** `pi-sandbox create` will fail if this file doesn't exist. Error message tells you exactly which path to check.

**How it's used:** The directory containing this file is mounted read-only into the VM at `/mnt/host-cert-dir`. The cert file is copied into the system trust store during provisioning. See [Provisioning](PROVISIONING.md) for details.

---

### `profiles.<name>.pi.configDir`

| Property | Value |
|---|---|
| **Type** | `string` |
| **Default** | `"~/.pi-sandbox"` |
| **Required** | No |

Path to the directory containing pi agent configuration files on the host. Supports `~` expansion.

This directory should contain:

| File | Required | How it's used in the VM |
|---|---|---|
| `auth.json` | **Yes** | Copied to `~/.pi/agent/auth.json` (writable — pi refreshes tokens) |
| `settings.json` | No | Copied and patched (sessionDir modified), written to `~/.pi/agent/settings.json` |
| `mcp.json` | No | Copied to `~/.pi/agent/mcp.json` |

**Why configurable:** Defaults to `~/.pi-sandbox` (same directory as the config file). You might want to point this elsewhere if you share pi config files across tools.

**Why this directory is mounted read-only:** Prevents the VM from modifying your host configuration. Auth tokens are *copied* (not symlinked) specifically because pi needs write access for token refresh. See [Architecture — Auth Quarantine](ARCHITECTURE.md#auth-quarantine-pattern) for the full rationale.

---

### `profiles.<name>.mcp.envPassthrough`

| Property | Value |
|---|---|
| **Type** | `string[]` |
| **Default** | `[]` |
| **Required** | No |

List of environment variable names to forward from the host shell to the guest VM.

**Example:** `["GHE_MCP_TOKEN", "GITHUB_MCP_TOKEN"]`

**How it works:** When you run `pi-sandbox enter`, the tool sets:
- `LIMA_SHELLENV_BLOCK=*` — blocks ALL host environment variables from reaching the guest
- `LIMA_SHELLENV_ALLOW=GHE_MCP_TOKEN, GITHUB_MCP_TOKEN` — allows only these through

**Why blanket-block + selective-allow:** Without blocking, Lima forwards your entire host environment to the guest. This leaks secrets, causes PATH conflicts, and makes the VM environment unpredictable. The allow-list ensures only the variables you explicitly choose reach the guest.

**Validation:** If a listed variable isn't set in your host shell, you'll see a warning (but creation continues). The MCP tools simply won't work in the VM until the variable is set.

---

### `profiles.<name>.vm.cpus`

| Property | Value |
|---|---|
| **Type** | `number` |
| **Default** | `4` |
| **Required** | No |

Number of CPU cores allocated to the VM.

---

### `profiles.<name>.vm.memory`

| Property | Value |
|---|---|
| **Type** | `string` |
| **Default** | `"8GiB"` |
| **Required** | No |

RAM allocated to the VM. Uses Lima's format (e.g., `"4GiB"`, `"16GiB"`).

---

### `profiles.<name>.vm.disk`

| Property | Value |
|---|---|
| **Type** | `string` |
| **Default** | `"50GiB"` |
| **Required** | No |

Disk size for the VM. Uses Lima's format.

**Note:** VM resource settings are baked in at creation time. Changing them requires `pi-sandbox recreate`. Lima does not support hot-reconfiguring VM resources.

---

## Profile System

### How profiles work

1. Define multiple profiles in `config.json` under `profiles`
2. Set `activeProfile` to your default
3. Override per-command with `--profile <name>`

```json
{
  "activeProfile": "corporate",
  "profiles": {
    "corporate": {
      "cert": { "hostBundlePath": "~/certs/corporate-ca.pem" },
      "mcp": { "envPassthrough": ["GHE_MCP_TOKEN", "GITHUB_MCP_TOKEN"] },
      "vm": { "cpus": 4, "memory": "8GiB", "disk": "50GiB" }
    },
    "personal": {
      "cert": null,
      "mcp": { "envPassthrough": ["GITHUB_MCP_TOKEN"] },
      "vm": { "cpus": 2, "memory": "4GiB", "disk": "30GiB" }
    }
  }
}
```

### Profile resolution

Each profile is merged with the built-in defaults. You only need to specify values that differ:

```json
{
  "activeProfile": "minimal",
  "profiles": {
    "minimal": {
      "mcp": { "envPassthrough": ["MY_TOKEN"] }
    }
  }
}
```

This profile inherits `cert: null`, `pi.configDir: "~/.pi-sandbox"`, `vm.cpus: 4`, etc. from defaults.

---

## Project-Level Overrides

Create `.pi-sandbox.json` in your project directory to override profile settings for that project only:

```json
{
  "vm": { "cpus": 8, "memory": "16GiB" }
}
```

**What you can override:** Any profile field (`cert`, `pi`, `mcp`, `vm`).

**What you cannot override:** `activeProfile` and the `profiles` map. These are user-level settings only.

**Precedence:** Project overrides have the highest priority:

```
defaults ← user profile ← project overrides
```

**Use case:** Give a resource-hungry project more CPU/RAM without changing your global config.

---

## Complete Examples

### Corporate environment

```json
{
  "activeProfile": "corporate",
  "profiles": {
    "corporate": {
      "cert": {
        "hostBundlePath": "~/certs/corporate-ca.pem"
      },
      "pi": {
        "configDir": "~/.pi-sandbox"
      },
      "mcp": {
        "envPassthrough": ["GHE_MCP_TOKEN", "GITHUB_MCP_TOKEN"]
      },
      "vm": {
        "cpus": 4,
        "memory": "8GiB",
        "disk": "50GiB"
      }
    }
  }
}
```

### Personal (minimal)

```json
{
  "activeProfile": "default",
  "profiles": {
    "default": {
      "mcp": {
        "envPassthrough": ["GITHUB_MCP_TOKEN"]
      }
    }
  }
}
```

Everything else uses built-in defaults: no cert, `~/.pi-sandbox` config dir, 4 CPUs, 8GiB RAM, 50GiB disk.

---

## Validation

`pi-sandbox create` and `pi-sandbox recreate` validate your config before attempting VM creation.

### Critical errors (block creation)

| Check | Error message | Fix |
|---|---|---|
| limactl not installed | "limactl not found" | `brew install lima` |
| Cert file missing | "Certificate not found at ..." | Check `cert.hostBundlePath` path |
| Config dir missing | "Pi config directory not found" | Run `pi-sandbox init` |
| auth.json missing | "auth.json not found" | Copy to config dir |

### Warnings (creation continues)

| Check | Warning message | Impact |
|---|---|---|
| MCP env var not set | "Environment variable X not set" | MCP tools won't work in VM |
| settings.json missing | "settings.json not found" | Pi uses its own defaults |
| mcp.json missing | "mcp.json not found" | No MCP servers configured |
