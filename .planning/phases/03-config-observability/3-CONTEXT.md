# Phase 3: Config Management & Observability - Context

**Gathered:** 2026-04-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Add the init workflow for first-time setup, config validation with actionable errors, project-level overrides, environment profiles, and the three observability commands (status, list, logs). After this phase, the tool is colleague-ready — new users can set up and diagnose issues independently.

</domain>

<decisions>
## Implementation Decisions

### init command
- **D-01:** Generate a commented config file with defaults — no interactive prompts. User edits the file themselves.
- **D-02:** Create `~/.pi-sandbox/` directory if it doesn't exist
- **D-03:** Write `~/.pi-sandbox/config.json` with all fields, sensible defaults, and inline comments explaining each field (JSON doesn't support comments, so use a JS file that writes JSON, or write JSON with `//`-prefixed comment keys like `"_comment_cert"`)
- **D-04:** If config already exists, don't overwrite — print message telling user to edit the existing file

### Config validation
- **D-05:** Validation runs before `create` (and `recreate`). Strict on critical issues, warns on non-critical.
- **D-06:** Critical (blocks create):
  - limactl not found or not callable
  - cert.hostBundlePath configured but file doesn't exist
  - pi.configDir doesn't exist
  - pi.configDir/auth.json doesn't exist
- **D-07:** Warnings (prints but proceeds):
  - MCP env vars in envPassthrough not set in host environment
  - pi.configDir/settings.json missing (will use pi defaults)
  - pi.configDir/mcp.json missing (no MCP servers configured)
- **D-08:** Each validation error is actionable: says what's wrong AND how to fix it. Example: "Certificate not found at /path/to/cert.pem — check cert.hostBundlePath in config"

### Profile switching
- **D-09:** All lifecycle commands accept `--profile <name>` option to override the `activeProfile` from config
- **D-10:** `--profile` is registered on each command via Commander (not a global option — Commander handles globals awkwardly)
- **D-11:** `resolveContext()` in helpers.js updated to accept optional profileName parameter, passes it to resolveProfile
- **D-12:** resolveProfile updated: if profileName argument provided, use it instead of config.activeProfile

### Project-level config overrides
- **D-13:** If `.pi-sandbox.json` exists in the project directory, it's deep-merged over the resolved profile
- **D-14:** Project overrides only affect profile fields (vm, cert, pi, mcp) — not activeProfile or profiles list
- **D-15:** Loaded in resolveContext after profile resolution: profile = deepMerge(profile, projectOverrides)

### VM registry
- **D-16:** `~/.pi-sandbox/vms.json` maps VM names to project directory paths: `{ "myproject": "/Users/me/projects/myproject" }`
- **D-17:** `create` command adds entry after successful VM creation
- **D-18:** `delete` command removes entry after successful deletion
- **D-19:** Registry is best-effort — if file is corrupt or missing, commands still work (just `list` shows nothing)

### status command
- **D-20:** Shows one-liner for current project: `myproject: Running` or `myproject: Not created`
- **D-21:** Uses limaStatus + registry for display

### list command
- **D-22:** Table format showing all pi-sandbox VMs:
  ```
  NAME          STATUS    PROJECT DIR
  myproject     Running   /Users/me/projects/myproject
  other-app     Stopped   /Users/me/projects/other-app
  ```
- **D-23:** Reads registry, checks limaStatus for each VM, formats as table
- **D-24:** If no VMs registered, print: "No sandboxes created yet."

### logs command
- **D-25:** Show cloud-init provisioning log from the VM using limaLogs
- **D-26:** If VM doesn't exist or isn't running, show error

### Agent's Discretion
- Exact format of the generated config file comments
- Table formatting details for `list`
- Whether validation function lives in config.js or a new validate.js
- Exact wording of validation error messages

</decisions>

<specifics>
## Specific Ideas

- The generated config file should be self-documenting enough that a colleague can figure out what to change without reading docs
- Validation errors should feel helpful, not scolding — "Certificate not found at X — check cert.hostBundlePath in ~/.pi-sandbox/config.json"
- The `--profile` flag makes it easy to test corporate vs personal config without editing the config file

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Core modules to modify
- `src/config.js` — loadConfig(), resolveProfile() need updates for project overrides and profile switching
- `src/commands/helpers.js` — resolveContext() needs --profile support and project override loading
- `bin/pi-sandbox.js` — Commander registration needs --profile option on lifecycle commands

### Core modules to use
- `src/lima.js` — limaStatus(), limaList(), limaLogs() for observability commands
- `src/commands/create.js` — Needs validation call before VM creation, registry update after
- `src/commands/delete.js` — Needs registry update after deletion

### Research
- `.planning/research/PITFALLS.md` — Pitfall #4 (Lima version compat), #12 (cert path varies)
- `.planning/research/FEATURES.md` — Table stakes features, differentiators

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/config.js` deepMerge() — reuse for project-level override merging
- `src/config.js` expandHome() — reuse for path validation
- `src/commands/helpers.js` resolveContext() — extend, don't replace
- `src/lima.js` limaStatus/limaLogs — ready for observability commands

### Established Patterns
- Commands export async functions, use resolveContext + handleError
- Config loading: readFileSync + JSON.parse with graceful fallback
- Error messages: descriptive, actionable, no stack traces

### Integration Points
- `create` command: add validation call before existing flow, add registry write after success
- `delete` command: add registry removal after success
- `bin/pi-sandbox.js`: add --profile option to lifecycle commands
- `resolveContext()`: accept profile override, load project overrides

</code_context>

<deferred>
## Deferred Ideas

- `pi-sandbox config show` to display effective merged config — v2
- Config migration tool for schema changes — v2
- `pi-sandbox doctor` diagnostic command — v2

</deferred>

---

*Phase: 03-config-observability*
*Context gathered: 2026-04-17*
