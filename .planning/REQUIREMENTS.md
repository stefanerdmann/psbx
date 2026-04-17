# Requirements: pi-sandbox

**Defined:** 2026-04-17
**Core Value:** One command creates a fully configured, isolated pi agent environment for any project — no manual setup, no implicit knowledge required.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### VM Lifecycle

- [ ] **VMLC-01**: User can create a VM for the current project directory with full pi agent provisioning
- [ ] **VMLC-02**: User can enter a running VM shell (auto-starts if VM is stopped)
- [ ] **VMLC-03**: User can start a stopped VM
- [ ] **VMLC-04**: User can stop a running VM
- [ ] **VMLC-05**: User can delete a VM with safety confirmation prompt
- [ ] **VMLC-06**: User can recreate a VM (delete + create) to apply config changes

### Configuration

- [ ] **CONF-01**: User has a per-user config file (`~/.pi-sandbox/config.json`) that drives all environment-specific behavior
- [ ] **CONF-02**: User can run `init` command to generate config with sensible defaults
- [ ] **CONF-03**: Tool validates config before VM creation (bad paths, missing deps, missing limactl)
- [ ] **CONF-04**: User can place `.pi-sandbox.json` in project directory to override user-level config
- [ ] **CONF-05**: User can define environment profiles (e.g., corporate, personal) that switch cert/auth/MCP sets

### Observability

- [ ] **OBSV-01**: User can check VM status for current project (running/stopped/not created)
- [ ] **OBSV-02**: User can list all pi-sandbox VMs across projects with their states
- [ ] **OBSV-03**: User can view Lima provisioning logs for debugging failed creates

### Host Integration

- [ ] **HOST-01**: Project directory is mounted writable at `/app` in the guest VM
- [ ] **HOST-02**: Pi config directory is mounted read-only; settings.json symlinked, auth.json copied for write access
- [ ] **HOST-03**: Pi session data is stored on host (`~/.pi-sandbox/sessions/<project>/`) and mounted into guest
- [ ] **HOST-04**: Corporate certificate is injected into VM trust store when configured (skipped when not)
- [ ] **HOST-05**: MCP bearer tokens are passed from host env vars to guest via configurable allow-list
- [ ] **HOST-06**: Lima VM resources (CPU, memory, disk) are configurable per-user and per-project

### Documentation

- [ ] **DOCS-01**: README with quickstart guide (install, init, create, enter)
- [ ] **DOCS-02**: Config file reference documenting all options, defaults, and examples
- [ ] **DOCS-03**: Architecture doc explaining mount strategy, auth quarantine pattern, cert handling, env var passthrough
- [ ] **DOCS-04**: Provisioning deep-dive doc explaining what happens inside the VM and why

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Developer Experience

- **DX-01**: Shell completions for zsh and bash (commands and VM names)
- **DX-02**: Colored/formatted output with progress indicators during VM creation
- **DX-03**: `pi-sandbox doctor` command to diagnose common setup issues

### Advanced Configuration

- **ACONF-01**: Config migration tool when schema changes between versions
- **ACONF-02**: `pi-sandbox config show` to display effective merged config for current project

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---|---|
| GUI / desktop app | CLI is the interface. Keep it simple. |
| Linux / Windows host support | macOS ARM only (Lima + VZ framework dependency) |
| Multi-VM per project | Violates 1:1 project-to-VM model. No clear benefit. |
| Auto-updating pi inside existing VMs | Recreate VM instead. Keeps provisioning simple and idempotent. |
| Docker/container support | This is specifically for Lima VMs. Don't try to be devcontainers. |
| VS Code integration | Out of scope. This is a CLI tool. |
| SSH config generation | Lima handles this internally. Don't duplicate. |
| Snapshot/restore | Lima VZ backend doesn't support this well. VMs are disposable by design. |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|---|---|---|
| CONF-01 | Phase 1 | Pending |
| HOST-01 | Phase 1 | Pending |
| HOST-02 | Phase 1 | Pending |
| HOST-03 | Phase 1 | Pending |
| HOST-04 | Phase 1 | Pending |
| HOST-05 | Phase 1 | Pending |
| HOST-06 | Phase 1 | Pending |
| VMLC-01 | Phase 2 | Pending |
| VMLC-02 | Phase 2 | Pending |
| VMLC-03 | Phase 2 | Pending |
| VMLC-04 | Phase 2 | Pending |
| VMLC-05 | Phase 2 | Pending |
| VMLC-06 | Phase 2 | Pending |
| CONF-02 | Phase 3 | Pending |
| CONF-03 | Phase 3 | Pending |
| CONF-04 | Phase 3 | Pending |
| CONF-05 | Phase 3 | Pending |
| OBSV-01 | Phase 3 | Pending |
| OBSV-02 | Phase 3 | Pending |
| OBSV-03 | Phase 3 | Pending |
| DOCS-01 | Phase 4 | Pending |
| DOCS-02 | Phase 4 | Pending |
| DOCS-03 | Phase 4 | Pending |
| DOCS-04 | Phase 4 | Pending |

**Coverage:**
- v1 requirements: 24 total
- Mapped to phases: 24
- Unmapped: 0 ✓

---
*Requirements defined: 2026-04-17*
*Last updated: 2026-04-17 after initial definition*
