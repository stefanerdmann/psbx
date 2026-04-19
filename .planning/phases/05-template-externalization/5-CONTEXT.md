# Phase 5: Template Externalization - Context

**Gathered:** 2026-04-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Extract the Lima YAML config and provisioning scripts from programmatic JavaScript code into Handlebars template files. After this phase, the Lima VM configuration is readable as actual YAML/shell files with clear conditional blocks, instead of being hidden in JavaScript string builders. The generated output must be identical to the current implementation.

</domain>

<decisions>
## Implementation Decisions

### Template structure
- **D-01:** Three separate template files:
  ```
  templates/
    lima.yaml.hbs              # VM config (mounts, resources, images)
    provision-system.sh.hbs    # Root provisioning script
    provision-user.sh.hbs      # User provisioning script
  ```
- **D-02:** All three rendered separately by `template.js`, then assembled into the final Lima YAML object. The provisioning scripts are rendered strings that get embedded as `provision[].script` values.
- **D-03:** Templates use Handlebars syntax: `{{variable}}` for values, `{{#if cert}}...{{/if}}` for conditional blocks.

### Dependencies
- **D-04:** Add `handlebars` as dependency in package.json
- **D-05:** Remove `js-yaml` dependency — no longer needed since the Lima config is now a Handlebars template that outputs YAML directly, not a JS object serialized to YAML
- **D-06:** `template.js` is rewritten: instead of building JS objects and calling `yaml.dump()`, it reads `.hbs` files, renders with Handlebars, and returns the YAML string

### Template rendering flow
- **D-07:** `template.js` prepares a context object from the profile and projectDir:
  ```js
  {
    vm: { cpus: 4, memory: '8GiB', disk: '50GiB' },
    pi: { configDir: '/Users/me/.pi-sandbox' },
    projectDir: '/Users/me/projects/myapp',
    cert: { dir: '/opt/certs', fileName: 'ca.pem' },  // or null
    systemProvision: '<rendered system script>',
    userProvision: '<rendered user script>'
  }
  ```
- **D-08:** Rendering order: provision-system.sh.hbs first → provision-user.sh.hbs second → lima.yaml.hbs last (receives the rendered scripts as context)

### Template file loading
- **D-09:** Templates loaded relative to the package directory (not cwd). Use `import.meta.url` to resolve template paths so they work both via `npm link` and `npm install -g`.
- **D-10:** Templates are read once and compiled with `Handlebars.compile()`. Cache the compiled templates for repeated use (though in practice each command only renders once).

### Provisioning script comments
- **D-11:** All existing comments and explanatory blocks stay in the templates — they're even more readable now as real `.sh.hbs` files
- **D-12:** Handlebars comments (`{{!-- comment --}}`) can be used for template-level notes that shouldn't appear in the rendered output

### Output compatibility
- **D-13:** The rendered Lima YAML must produce functionally identical VMs to the current programmatic approach. Same mounts, same provisioning steps, same conditional behavior.
- **D-14:** Indentation in the YAML template must be correct — Handlebars doesn't manage YAML indentation, so the template itself must have the right spacing

### Documentation update
- **D-15:** Update docs/ARCHITECTURE.md to reflect the new template approach (replacing the "YAML Generation" section)
- **D-16:** Update docs/PROVISIONING.md to reference the template files instead of describing code in template.js

### Agent's Discretion
- Exact Handlebars helper functions if needed (e.g., for indentation)
- Whether to use Handlebars partials or simple string embedding for the provisioning scripts in lima.yaml.hbs
- Template caching implementation details

</decisions>

<specifics>
## Specific Ideas

- "The whole Lima config is hidden in code — it would be better to have a template.yaml with placeholders that can be filled by pi-sandbox. Now it is hard to understand what happens."
- Templates should look like real YAML/shell files that happen to have a few `{{placeholders}}` — not like code that generates YAML

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Source code to replace
- `src/template.js` — Current programmatic implementation. Every function here gets replaced by template rendering. The CONTEXT and COMMENTS from the current code must be preserved in the templates.

### Documentation to update
- `docs/ARCHITECTURE.md` § "YAML Generation" — Needs rewrite to describe Handlebars approach
- `docs/PROVISIONING.md` — References to template.js should point to template files instead

### Package config
- `package.json` — Remove js-yaml, add handlebars. Update `files` array if templates/ needs to be included in npm package.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/template.js` current output — use as the reference for what the templates must produce. Render current output for cert and no-cert profiles and use as test fixtures.
- The context object structure (profile + projectDir) is already established — templates receive the same data.

### Established Patterns
- `buildLimaYaml(profile, projectDir)` is the public API called by create.js and recreate.js — this signature stays the same, only the internals change
- `writeLimaYaml(profile, projectDir, outputPath)` also stays as-is

### Integration Points
- `src/commands/create.js` calls `writeLimaYaml()` — no changes needed if the function signature stays
- `src/commands/recreate.js` calls `writeLimaYaml()` — same
- `package.json` `files` array must include `templates/` for npm distribution

</code_context>

<deferred>
## Deferred Ideas

- Allow users to provide custom template overrides (e.g., `~/.pi-sandbox/templates/`) — future enhancement
- Template validation (check rendered YAML is valid before writing) — could add later

</deferred>

---

*Phase: 05-template-externalization*
*Context gathered: 2026-04-19*
