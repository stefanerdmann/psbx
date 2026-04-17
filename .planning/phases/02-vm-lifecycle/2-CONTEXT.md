# Phase 2: VM Lifecycle Commands - Context

**Gathered:** 2026-04-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Implement all six VM lifecycle commands (create, enter, start, stop, delete, recreate) using the core modules from Phase 1. After this phase, the tool is fully functional end-to-end — a user can create a sandboxed pi environment, work in it, and tear it down.

</domain>

<decisions>
## Implementation Decisions

### create command
- **D-01:** Flow: loadConfig → resolveProfile → getVmName → check collision via limaStatus → buildLimaYaml → write temp file → limaStart → delete temp file → print success
- **D-02:** Temp YAML written to `/tmp/lima-<vmname>.yaml`, deleted after limactl completes (success or failure, use try/finally)
- **D-03:** If VM already exists, error with message: "VM '<name>' already exists. Use `pi-sandbox recreate` to rebuild."
- **D-04:** Create the session directory on host before starting VM: `<projectDir>/.pi-sandbox/sessions/`

### enter command
- **D-05:** Flow: getVmName → limaStatus → if not created, error with hint → if stopped, auto-start (resume) → limaShell with envPassthrough from config
- **D-06:** Auto-start prints a message: "VM is stopped. Starting..."
- **D-07:** envPassthrough comes from resolved profile's `mcp.envPassthrough` array, forwarded via LIMA_SHELLENV_ALLOW

### start command
- **D-08:** Simple: getVmName → check exists → limaResume (limactl start <name>, no yaml path)
- **D-09:** Need to add `limaResume(name)` to lima.js — `limactl start <name>` without yaml path to resume stopped VM

### stop command
- **D-10:** Simple: getVmName → check exists + running → limaStop

### delete command
- **D-11:** Prompt for confirmation using Node.js readline: "Are you sure you want to delete sandbox '<name>'? [y/N]"
- **D-12:** If running, stop first then delete
- **D-13:** Default is No — only proceeds on 'y' or 'Y'

### recreate command
- **D-14:** Prompt for confirmation: "This will delete and recreate sandbox '<name>'. All VM state will be lost. Continue? [y/N]"
- **D-15:** Flow: prompt → if yes: stop (if running) → delete → create (full create flow)
- **D-16:** Sessions survive because they're in the project directory, not the VM

### Error handling
- **D-17:** All commands catch LimaError and print user-friendly messages (no stack traces)
- **D-18:** Exit with non-zero code on failure (process.exit(1))
- **D-19:** Common pre-checks extracted to a shared helper: loadConfig, resolveProfile, getVmName in one call

### Agent's Discretion
- Exact console output formatting and emoji usage
- readline implementation details for confirmation prompts
- Whether to use a shared `withConfig()` helper or repeat the load/resolve/name pattern

</decisions>

<specifics>
## Specific Ideas

- Follow the prototype's UX patterns from `zshrc_example` — similar messages and flow
- `enter` should feel instant when VM is running — minimal output, just drop into the shell
- `create` can be verbose since provisioning takes minutes — show progress messages

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Core modules (Phase 1 output — these are the building blocks)
- `src/config.js` — loadConfig(), resolveProfile(), getVmName() functions
- `src/lima.js` — limaStart(), limaStop(), limaDelete(), limaShell(), limaStatus() functions + LimaError class
- `src/template.js` — buildLimaYaml(), writeLimaYaml() functions

### Prototype reference (UX patterns to follow)
- `legacy/zshrc_example` — Original shell functions showing create/enter/delete flow and user messages
- `legacy/create_pi_vm.sh` — Original create flow

### Research
- `.planning/research/PITFALLS.md` — Pitfall #10 (VM name collisions), #11 (special chars in dir names)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/config.js` — loadConfig + resolveProfile + getVmName already handle all config resolution
- `src/lima.js` — All limactl wrappers ready. Need to add `limaResume(name)` for restarting stopped VMs
- `src/template.js` — buildLimaYaml ready, writeLimaYaml writes to specified path

### Established Patterns
- Lima wrapper functions throw LimaError on failure — commands should catch and format
- limaStatus returns null for non-existent VMs — use for existence checks
- limaShell accepts envPassthrough option — connects directly to config's mcp.envPassthrough

### Integration Points
- Each command file in `src/commands/` exports a single function called by Commander
- Commands need to: import config/lima/template modules → orchestrate → handle errors
- `bin/pi-sandbox.js` already registers all stubs — just replace stub implementations

</code_context>

<deferred>
## Deferred Ideas

- `--force` flag on delete to skip confirmation — could add later if needed
- `--profile` flag to override active profile per-command — Phase 3 (profiles)
- Verbose/quiet flags for output control — future enhancement

</deferred>

---

*Phase: 02-vm-lifecycle*
*Context gathered: 2026-04-17*
