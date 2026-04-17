# pi-sandbox

## What This Is

A Node.js CLI tool that manages per-project Lima VMs for sandboxing the pi coding agent on macOS ARM. Each project gets its own isolated VM with the pi agent pre-installed, host project files mounted in, and per-user configuration driving environment-specific behavior (corporate certs, auth tokens, MCP servers, model providers). Built for maintainability and shareability with colleagues.

## Core Value

One command creates a fully configured, isolated pi agent environment for any project — no manual setup, no implicit knowledge required.

## Requirements

### Validated

(None yet - ship to validate)

### Active

- [ ] CLI with commands: create, enter, start, stop, delete
- [ ] Per-user configuration file that drives all environment-specific behavior (certs, tokens, providers, MCP servers, Lima resources)
- [ ] Lima VM template generated from config (not hardcoded env vars)
- [ ] Host mount for project directory (writable) at /app in guest
- [ ] Host mount for pi config (~/.pi) with read-only symlinks for settings, copied auth tokens
- [ ] Host mount for pi session data so sessions survive VM deletion
- [ ] Optional corporate certificate injection (skip when not configured)
- [ ] MCP token passthrough via environment variables from host to guest
- [ ] System provisioning: Node.js, pi agent installation
- [ ] User provisioning: config symlinks, auth copy, npm global setup, cert env vars
- [ ] Well-structured codebase with clear separation of concerns
- [ ] Documentation that makes implicit knowledge explicit (mount strategy, auth quarantine pattern, cert handling, env var passthrough)

### Out of Scope

- GUI / desktop app - CLI is the interface
- Linux / Windows host support - macOS ARM only (Lima + VZ framework)
- Multi-VM per project - one VM per project directory
- Auto-updating pi inside existing VMs - recreate VM to update

## Context

**Current state:** Working prototype as loose shell scripts and a Lima YAML template with hardcoded env var substitution. Works but fragile — implicit dependencies between files, no config validation, environment differences (corporate vs personal Mac) handled by manual editing.

**Key implementation details discovered in prototype:**
- Lima `vmType: vz` with `mountType: virtiofs` is the right combo for macOS ARM (fast, native)
- Auth tokens must be *copied* not symlinked into guest (pi needs write access for token refresh)
- Settings and MCP config can be symlinked read-only from host
- `npm config set prefix '~/.npm-global'` needed in guest so pi can install packages without sudo
- `NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt` required in guest for Node.js to respect system certs
- `LIMA_SHELLENV_BLOCK=*` + `LIMA_SHELLENV_ALLOW` controls which host env vars reach the guest
- Pi sessions stored at configurable `sessionDir` in settings.json
- Certificate path on host is dynamic (resolved via `python3 -m certifi` + `realpath`)
- `apt` lock must be waited on during provisioning (cloud-init race)

**Host directory layout (current):**
```
~/.pi/
  agent/
    auth.json      # Copilot auth tokens (copied to guest, writable)
    settings.json  # Pi settings (symlinked to guest, read-only)
    mcp.json       # MCP server config (copied to guest)
```

**Guest directory layout (current):**
```
/app/              # Project files (mounted from host cwd)
/mnt/pi-host-config/  # Host ~/.pi (read-only mount)
/pi/data/sessions/    # Pi session storage (currently guest-only, moving to host mount)
~/.pi/agent/          # Assembled config (symlinks + copies from mount)
~/.npm-global/        # User-space npm prefix
```

**Target users:** Colleagues on similar corporate macOS ARM setups with GitHub Copilot Enterprise subscriptions. Some variation in certs, tokens, and provider preferences.

## Constraints

- **Runtime**: Node.js (already required by pi agent) — keep code simple, minimal dependencies
- **Host OS**: macOS ARM only (Lima + Apple Virtualization framework)
- **Guest OS**: Ubuntu Noble (aarch64 cloud image)
- **Auth pattern**: GitHub Copilot Enterprise via auth.json; MCP tokens via env vars
- **Lima**: Must use `limactl` CLI (no Lima API, just subprocess calls)

## Key Decisions

| Decision | Rationale | Outcome |
| --- | --- | --- |
| Node.js CLI over pure shell | Already a dependency (pi needs Node), better config handling, easier to structure | - Pending |
| Per-user config file drives all variation | Avoids hardcoding, makes environment differences explicit and declarative | - Pending |
| Session data on host not guest | Sessions are valuable; VMs are disposable. Survives VM delete/recreate | - Pending |
| Auth tokens copied (not symlinked) | Pi needs write access for token refresh cycle; protect host original | - Pending |
| Settings/MCP symlinked read-only | Enforce host as source of truth; prevent guest drift | - Pending |
| VM named after project directory | Simple 1:1 mapping, `basename $PWD` as convention | - Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check - still the right priority?
3. Audit Out of Scope - reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-17 after initialization*
