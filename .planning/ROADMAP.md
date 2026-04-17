# Roadmap: pi-sandbox

**Created:** 2026-04-17
**Granularity:** Coarse (3-5 phases)
**Total phases:** 4
**Total requirements:** 24

## Phase Overview

| # | Phase | Goal | Requirements | Success Criteria |
|---|---|---|---|---|
| 1 | Core Infrastructure | Config, Lima wrapper, and template builder modules that produce a valid Lima YAML from user config | CONF-01, HOST-01, HOST-02, HOST-03, HOST-04, HOST-05, HOST-06 | 3 |
| 2 | VM Lifecycle Commands | All CLI commands to create, manage, and destroy project VMs | VMLC-01, VMLC-02, VMLC-03, VMLC-04, VMLC-05, VMLC-06 | 4 |
| 3 | Config Management & Observability | Init workflow, validation, profiles, project overrides, status/list/logs | CONF-02, CONF-03, CONF-04, CONF-05, OBSV-01, OBSV-02, OBSV-03 | 4 |
| 4 | Documentation | Complete docs: quickstart, config reference, architecture, provisioning | DOCS-01, DOCS-02, DOCS-03, DOCS-04 | 3 |

---

## Phase 1: Core Infrastructure

**Goal:** Build the three foundational modules — config loader, Lima subprocess wrapper, and template builder — plus the project scaffold (package.json, bin entry, Commander skeleton). By the end, the tool can load a user config and produce a valid Lima YAML file with all mounts, provisioning scripts, and environment setup.

**Requirements:**
- CONF-01: Per-user config file drives all environment-specific behavior
- HOST-01: Project directory mounted writable at /app
- HOST-02: Pi config mount (read-only symlinks + auth copy)
- HOST-03: Pi sessions stored on host, mounted into guest
- HOST-04: Optional certificate injection
- HOST-05: MCP token passthrough via env var allow-list
- HOST-06: Configurable Lima resources (CPU, memory, disk)

**Success Criteria:**
1. `node bin/pi-sandbox.js` runs and shows Commander help with all command stubs
2. Config module loads `~/.pi-sandbox/config.json`, merges with defaults, and returns a complete config object
3. Template builder produces a valid Lima YAML that includes: project mount, pi config mount, session mount, conditional cert mount, conditional cert provisioning, system provisioning (Node.js + pi), user provisioning (auth copy, symlinks, npm config, env vars), and configurable CPU/memory/disk

**UI hint**: no

---

## Phase 2: VM Lifecycle Commands

**Goal:** Implement all six VM lifecycle commands (create, enter, start, stop, delete, recreate) using the core modules from Phase 1. After this phase, the tool is fully functional end-to-end — a user can create a sandboxed pi environment, work in it, and tear it down.

**Requirements:**
- VMLC-01: User can create a VM for current project with full provisioning
- VMLC-02: User can enter a running VM (auto-start if stopped)
- VMLC-03: User can start a stopped VM
- VMLC-04: User can stop a running VM
- VMLC-05: User can delete a VM with safety confirmation
- VMLC-06: User can recreate a VM (delete + create)

**Success Criteria:**
1. `pi-sandbox create` in a project directory provisions a Lima VM with pi agent installed and all mounts working
2. `pi-sandbox enter` drops user into VM shell at /app with MCP tokens available; auto-starts stopped VMs
3. `pi-sandbox stop` / `pi-sandbox start` correctly stop and resume VMs without data loss
4. `pi-sandbox delete` prompts for confirmation then removes the VM; `pi-sandbox recreate` chains delete+create

**UI hint**: no

---

## Phase 3: Config Management & Observability

**Goal:** Add the init workflow for first-time setup, config validation with actionable errors, project-level overrides, environment profiles, and the three observability commands (status, list, logs). After this phase, the tool is colleague-ready — new users can set up and diagnose issues independently.

**Requirements:**
- CONF-02: Init command generates config with sensible defaults
- CONF-03: Config validation before VM creation (bad paths, missing deps)
- CONF-04: Project-level config overrides via `.pi-sandbox.json`
- CONF-05: Environment profiles (corporate, personal)
- OBSV-01: Status command for current project VM
- OBSV-02: List all pi-sandbox VMs across projects
- OBSV-03: View Lima provisioning logs

**Success Criteria:**
1. `pi-sandbox init` walks user through config creation, writes valid `~/.pi-sandbox/config.json` with all required fields
2. `pi-sandbox create` with invalid config (bad cert path, missing limactl) shows actionable error message before attempting VM creation
3. `.pi-sandbox.json` in project dir overrides user config (e.g., more CPU for heavy project); environment profiles switch between cert/no-cert, different auth
4. `pi-sandbox status` / `pi-sandbox list` / `pi-sandbox logs` show useful formatted output

**UI hint**: no

---

## Phase 4: Documentation

**Goal:** Write complete documentation so that the implicit knowledge from the prototype and development process is captured. A colleague can install, configure, use, and troubleshoot pi-sandbox without asking the author.

**Requirements:**
- DOCS-01: README with quickstart guide
- DOCS-02: Config file reference
- DOCS-03: Architecture doc (mounts, auth quarantine, certs, env vars)
- DOCS-04: Provisioning deep-dive doc

**Success Criteria:**
1. README covers: what pi-sandbox is, prerequisites, install, init, create first VM, enter, common workflows
2. Config reference documents every config field with type, default, description, and example
3. Architecture doc explains the mount strategy diagram, auth quarantine pattern, cert injection flow, and env var passthrough mechanism with clear rationale for each design decision

**UI hint**: no

---

## Requirement Coverage

All 24 v1 requirements mapped:

| Phase | Requirements | Count |
|---|---|---|
| Phase 1 | CONF-01, HOST-01, HOST-02, HOST-03, HOST-04, HOST-05, HOST-06 | 7 |
| Phase 2 | VMLC-01, VMLC-02, VMLC-03, VMLC-04, VMLC-05, VMLC-06 | 6 |
| Phase 3 | CONF-02, CONF-03, CONF-04, CONF-05, OBSV-01, OBSV-02, OBSV-03 | 7 |
| Phase 4 | DOCS-01, DOCS-02, DOCS-03, DOCS-04 | 4 |
| **Total** | | **24** |

Unmapped: 0 ✓

---
*Roadmap created: 2026-04-17*
*Last updated: 2026-04-17 after initial creation*
