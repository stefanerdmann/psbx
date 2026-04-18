# Phase 4: Documentation - Context

**Gathered:** 2026-04-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Write complete documentation so that the implicit knowledge from the prototype and development process is captured. A colleague can install, configure, use, and troubleshoot pi-sandbox without asking the author.

</domain>

<decisions>
## Implementation Decisions

### Documentation philosophy
- **D-01:** Every section explains WHY, not just WHAT. The rationale behind design decisions is as important as the decisions themselves.
- **D-02:** When a pattern exists because of a non-obvious constraint (e.g., auth tokens must be copied not symlinked), explain the failure mode that would occur without it.
- **D-03:** When alternatives were considered and rejected, briefly mention them so the reader doesn't re-explore dead ends.

### README.md
- **D-04:** Structure: What is pi-sandbox → Prerequisites → Install → Quick Start (init, create, enter) → Commands reference → Common workflows → Project-level overrides → FAQ/Troubleshooting
- **D-05:** Prerequisites: macOS ARM (Apple Silicon), Lima (`brew install lima`), Node.js >= 20, pi auth tokens, optionally corporate cert bundle
- **D-06:** Quick Start should be copy-pasteable — a colleague reads it top to bottom and has a working sandbox
- **D-07:** Commands reference is a concise table, not full man pages — detailed behavior is in the other docs

### docs/CONFIG.md
- **D-08:** Document every config field with: path, type, default, description, example, and WHY it exists
- **D-09:** Show complete example configs for both corporate (with cert, MCP tokens) and personal (minimal) setups
- **D-10:** Explain the profile system: why profiles exist, how activeProfile works, how --profile flag overrides, how project-level .pi-sandbox.json merges
- **D-11:** Explain config layering: defaults → user config → project overrides, with precedence rules

### docs/ARCHITECTURE.md
- **D-12:** Cover four key patterns, each with its own section: mount strategy, auth quarantine, cert injection, env var passthrough
- **D-13:** Each pattern section has: Problem → Solution → Why this approach → What breaks if changed → Diagram/flow where helpful
- **D-14:** Include the host/guest directory layout diagram showing what lives where and why
- **D-15:** Explain the Lima YAML generation approach (JS objects → YAML) and why it replaced the envsubst template

### docs/PROVISIONING.md
- **D-16:** Walk through system provisioning script block by block, explaining what each does and WHY
- **D-17:** Walk through user provisioning script block by block, same approach
- **D-18:** Call out the pitfalls each block addresses (apt lock race, mount readiness, cert consumers, npm prefix)
- **D-19:** Explain the settings.json copy+patch approach for sessionDir and why it exists
- **D-20:** Document the conditional nature of provisioning (what changes with/without cert, with/without MCP)

### Agent's Discretion
- Exact markdown formatting and heading hierarchy
- Whether to include ASCII diagrams or describe flows in prose
- Level of detail in troubleshooting section
- Whether to add a CHANGELOG.md (nice but not required)

</decisions>

<specifics>
## Specific Ideas

- "Details are important so someone can comprehend why things were implemented in a certain way"
- The architecture doc should be the reference someone reads when they need to change the provisioning or mount strategy — it should give them confidence about what they can and can't change safely
- The provisioning doc should read almost like annotated source code — each block with its explanation

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before writing documentation.**

### Source code (the source of truth for docs)
- `src/config.js` — Config schema, defaults, loadConfig, resolveProfile, getVmName, deepMerge
- `src/template.js` — buildLimaConfig, buildMounts, buildSystemProvision, buildUserProvision
- `src/lima.js` — All limactl wrapper functions, LimaError
- `src/validate.js` — Validation rules (what's critical vs warning)
- `src/registry.js` — VM registry functions
- `src/commands/helpers.js` — resolveContext with profile override + project overrides
- `src/commands/create.js` — Create flow (validation → collision check → session dir → YAML → start → register)
- `src/commands/init.js` — Init flow and guidance output
- `bin/pi-sandbox.js` — All command registrations with --profile flag

### Project context
- `.planning/PROJECT.md` — Key decisions table, context section with implementation details
- `.planning/research/ARCHITECTURE.md` — Architecture research with data flow diagrams
- `.planning/research/PITFALLS.md` — All known pitfalls and their mitigations
- `.planning/phases/01-core-infrastructure/1-CONTEXT.md` — Decisions D-01 through D-19 (config schema, mounts, provisioning)

### Legacy reference
- `legacy/pi-lima-template.yaml` — Original provisioning scripts (for comparison and verification)
- `legacy/create_pi_vm.sh` — Original create flow
- `legacy/zshrc_example` — Original shell helper functions

</canonical_refs>

<code_context>
## Existing Code Insights

### Key Code to Document
- `src/template.js` buildSystemProvision/buildUserProvision — the provisioning scripts are generated programmatically with comments, but the docs should expand on the WHY behind each block
- `src/config.js` DEFAULTS object — defines the full schema, docs must match exactly
- `src/validate.js` — the validation rules define what's required vs optional, docs should mirror this

### Patterns to Explain
- Auth quarantine: copy auth (writable), symlink settings (read-only) → WHY each file gets different treatment
- Cert injection: system certs + NODE_EXTRA_CA_CERTS → WHY both are needed
- Session storage in project dir → WHY not in VM, WHY not in central location
- npm global prefix → WHY pi agent needs it, what fails without it
- LIMA_SHELLENV_BLOCK/ALLOW → WHY blanket block + selective allow

</code_context>

<deferred>
## Deferred Ideas

None — this is the final phase.

</deferred>

---

*Phase: 04-documentation*
*Context gathered: 2026-04-17*
