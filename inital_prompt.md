# AGENT.md — Context for AI agents working on this repository

## Project Summary

pi-sandbox creates isolated Lima VMs on macOS Apple Silicon for running the
pi coding agent. Each project directory gets its own VM with shared auth
from the host and a profile system for different environments (corporate vs personal).

## Repository Structure

```
bin/                    CLI commands (pi-create, pi-enter, pi-delete, pi-profile)
lib/common.sh           Shared shell library (logging, profile loading, template processing)
templates/lima.yaml     Lima VM template with conditional blocks (#@if / #@endif)
profiles/               Environment profiles (corporate, personal)
  <name>/profile.conf   Shell-sourceable config variables (PI_SANDBOX_*)
  <name>/settings.json  Pi agent settings deployed to ~/.pi/agent/
  <name>/mcp.json       MCP server config deployed to ~/.pi/agent/
shell/pi-sandbox.zsh    Shell integration (adds bin/ to PATH)
install.sh              Installer — copies to ~/.pi-sandbox/, sets active profile
```

## Key Design Decisions

- **Profiles, not flags**: Environment differences (cert, MCP servers, resources) are
  captured in named profile directories, not CLI flags. This keeps commands simple
  (`pi-create`) and makes environments reproducible.
- **Template conditionals**: The Lima YAML template uses `#@if CONDITION` / `#@endif`
  markers. `lib/common.sh:process_template()` strips or keeps blocks based on profile
  variables. Only `envsubst`-safe variables (prefixed list) are substituted.
- **Host config is read-only**: `~/.pi/agent` is mounted read-only. Auth and config
  files are **copied** into the VM during provisioning so the VM can modify its own
  copies (e.g. token refresh) without affecting the host.
- **Sessions are VM-local**: Stored at `/pi/data/sessions` inside the VM. Destroyed
  on `pi-delete`. This is intentional — session data is per-project.
- **MCP tokens via env vars**: Tokens are forwarded from the host shell into the VM
  at `pi-enter` time using `LIMA_SHELLENV_ALLOW`. Never written to disk in the VM.

## Adding a New Conditional Feature

1. Add `PI_SANDBOX_<FEATURE>` to relevant `profile.conf` files
2. Add `#@if <FEATURE>` / `#@endif <FEATURE>` blocks to `templates/lima.yaml`
3. Add `"<FEATURE>"` to the `conditions` array in `lib/common.sh:process_template()`
4. Document in README.md under Profile Configuration Reference

## Testing Changes

Since this runs on macOS with Lima, there are no automated tests.
Manual testing workflow:
```bash
./install.sh <profile>
cd /tmp/test-project && mkdir -p . && pi-create
pi-enter   # verify provisioning, check pi starts
pi-delete  # verify cleanup
```
