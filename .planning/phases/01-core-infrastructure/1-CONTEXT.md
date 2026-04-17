# Phase 1: Core Infrastructure - Context

**Gathered:** 2026-04-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Build the project scaffold (package.json, bin entry, Commander skeleton with all command stubs) and three foundational modules: config loader, Lima subprocess wrapper, and template builder. By the end, the tool can load a user config and produce a valid Lima YAML file with all mounts, provisioning scripts, and environment setup. No commands are functional yet — Phase 2 wires them up.

</domain>

<decisions>
## Implementation Decisions

### Project scaffold
- **D-01:** ESM module system (`"type": "module"` in package.json, `import`/`export` throughout)
- **D-02:** Commander.js for CLI framework, js-yaml for YAML generation, node:child_process for subprocess calls
- **D-03:** Directory layout: `bin/pi-sandbox.js` (entry), `src/commands/` (one file per command, stubs only in Phase 1), `src/config.js`, `src/lima.js`, `src/template.js`
- **D-04:** Distribute as npm package (`npm install -g pi-sandbox`). `bin` field in package.json points to `bin/pi-sandbox.js`

### Config schema
- **D-05:** Profile-based JSON config at `~/.pi-sandbox/config.json`. Shape:
  ```json
  {
    "activeProfile": "corporate",
    "profiles": {
      "corporate": {
        "cert": { "hostBundlePath": "/path/to/cacert.pem" },
        "pi": { "configDir": "~/.pi-sandbox" },
        "mcp": { "envPassthrough": ["GHE_MCP_TOKEN", "GITHUB_MCP_TOKEN"] },
        "vm": { "cpus": 4, "memory": "8GiB", "disk": "50GiB" }
      }
    }
  }
  ```
- **D-06:** Config loading is simple `fs.readFileSync` + `JSON.parse` with defaults merging. No cosmiconfig. Single known path.
- **D-07:** Defaults built into the tool cover every field — tool works with minimal config (just the active profile with any non-default values)

### Host config directory
- **D-08:** Default pi config host path is `~/.pi-sandbox/` (not `~/.pi/agent/`). Contains: `config.json`, `auth.json`, `settings.json`, `mcp.json`. Configurable via `pi.configDir` in profile.
- **D-09:** Layout:
  ```
  ~/.pi-sandbox/
    config.json          # pi-sandbox tool config (profiles, VM settings)
    auth.json            # Copilot auth tokens (copied to guest, writable)
    settings.json        # Pi agent settings (symlinked to guest, read-only)
    mcp.json             # MCP server config (copied to guest)
  ```

### VM naming
- **D-10:** VM name = `basename(cwd)`, sanitized (lowercase, non-alphanumeric replaced with hyphens). Error on collision with existing Lima VM of same name.

### Session storage
- **D-11:** Sessions stored in project directory: `/app/.pi-sandbox/sessions/` in guest, which maps to `<project-dir>/.pi-sandbox/sessions/` on host. No additional mount needed — uses the existing writable project mount.
- **D-12:** Pi `settings.json` is generated during user provisioning: copy host settings.json, patch `sessionDir` to `/app/.pi-sandbox/sessions`. This way users don't think about guest paths.

### Template builder — mounts
- **D-13:** Three mounts (or four with cert):
  1. Pi config dir (`~/.pi-sandbox/` default) → `/mnt/pi-host-config` (read-only)
  2. Project dir (cwd) → `/app` (writable)
  3. Cert dir → `/mnt/host-cert-dir` (read-only) — **only if cert configured**

### Template builder — system provisioning script
- **D-14:** Built programmatically as a string by template.js, conditional on config:
  1. Wait for apt lock (`while fuser /var/lib/dpkg/lock-frontend ...`)
  2. Wait for mount readiness (`until mountpoint -q /mnt/pi-host-config ...`)
  3. **If cert configured:** install ca-certificates, copy cert from mount, update-ca-certificates
  4. apt-get update, install curl gnupg git
  5. Install Node.js 22 via nodesource
  6. `npm install -g @mariozechner/pi-coding-agent`

### Template builder — user provisioning script
- **D-15:** Built programmatically, conditional on config:
  1. Create session dir: `mkdir -p /app/.pi-sandbox/sessions`
  2. Set up `~/.pi/agent/` directory
  3. Symlink settings.json from mount (read-only) then patch: copy, modify `sessionDir`, write to `~/.pi/agent/settings.json`
  4. Copy auth.json from mount, `chmod 600`
  5. **If mcp.json exists on mount:** copy to `~/.pi/agent/mcp.json`
  6. Configure npm global prefix: `mkdir -p ~/.npm-global && npm config set prefix ~/.npm-global`
  7. Add `~/.npm-global/bin` to PATH in `.bashrc`
  8. **If cert configured:** add `NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt` to `.bashrc`
  9. Add `cd /app` to `.bashrc`

### Template builder — Lima config
- **D-16:** Fixed Lima settings: `vmType: "vz"`, `mountType: "virtiofs"`, Ubuntu Noble aarch64 image, `user.name: "pi"`
- **D-17:** Configurable from profile: `cpus`, `memory`, `disk` (with sensible defaults: 4 CPUs, 8GiB RAM, 50GiB disk)

### Lima wrapper
- **D-18:** Thin wrapper around `child_process.execFileSync`/`spawnSync` calling `limactl`. Functions: `start(name, yamlPath)`, `stop(name)`, `delete(name)`, `shell(name, opts)`, `status(name)`, `list()`. All use `{ stdio: 'inherit' }` to stream output.
- **D-19:** Error handling: catch subprocess errors, provide context-aware messages (e.g., "limactl not found — install Lima first")

### Agent's Discretion
- Exact default values for CPU/memory/disk
- Config defaults merging implementation details
- Provisioning script formatting and comment style
- Error message wording
- Lima wrapper internal error handling patterns

</decisions>

<specifics>
## Specific Ideas

- Provisioning scripts should be well-commented — each block explains WHY it exists (the "quarantine" pattern for auth, why npm needs a user-space prefix, why NODE_EXTRA_CA_CERTS is needed)
- The existing prototype files (`create_pi_vm.sh`, `pi-lima-template.yaml`, `settings.json`, `mcp.json`, `zshrc_example`) are the reference implementation — archive them but use them as the source of truth for provisioning behavior
- Config schema should make it obvious what's optional — cert section absent = no cert handling, mcp section absent = no MCP setup

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing prototype (source of truth for provisioning behavior)
- `pi-lima-template.yaml` - Current Lima template with all mounts and provisioning scripts
- `create_pi_vm.sh` - Current VM creation script showing cert resolution and envsubst flow
- `settings.json` - Current pi agent settings (model, provider, session dir, packages)
- `mcp.json` - Current MCP server configuration (GHE + GitHub endpoints, bearer token env vars)
- `zshrc_example` - Current shell functions and env var setup (LIMA_SHELLENV_BLOCK/ALLOW pattern)

### Research
- `.planning/research/STACK.md` - Stack decisions (Commander, js-yaml, child_process)
- `.planning/research/ARCHITECTURE.md` - Directory layout, data flow diagrams, config layering, provisioning script breakdown
- `.planning/research/PITFALLS.md` - Known pitfalls to address in template builder (apt lock, mount readiness, cert consumers, env leakage)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `pi-lima-template.yaml` — The provisioning scripts are battle-tested. Port their logic into template.js programmatic generation, preserving all the careful ordering and workarounds.
- `create_pi_vm.sh` — The cert resolution pattern (`python3 -m certifi` + `realpath`) should be ported to config validation or a helper function.
- `zshrc_example` — The `LIMA_SHELLENV_BLOCK=*` + `LIMA_SHELLENV_ALLOW` pattern must be preserved in the enter command.

### Established Patterns
- Auth quarantine: symlink read-only settings, copy writable auth. This pattern is validated and must be preserved.
- Mount strategy: host pi config read-only, project dir writable. Proven pattern.
- Cert handling: copy to `/usr/local/share/ca-certificates/`, run `update-ca-certificates`, set `NODE_EXTRA_CA_CERTS`. Covers all cert consumers (Node, git, curl).

### Integration Points
- Template builder output is consumed by `limactl start` — must produce valid Lima YAML
- Config schema is consumed by template builder, all commands, and eventually `init`
- Lima wrapper is consumed by all command handlers

</code_context>

<deferred>
## Deferred Ideas

- `pi-sandbox init` command (interactive config setup) — Phase 3
- Config validation with actionable errors — Phase 3
- Project-level config overrides (`.pi-sandbox.json`) — Phase 3
- Environment profile switching at runtime — Phase 3
- Adding `.pi-sandbox/` to `.gitignore` suggestion — Phase 3 (init command)

</deferred>

---

*Phase: 01-core-infrastructure*
*Context gathered: 2026-04-17*
