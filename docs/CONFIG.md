# Configuration Reference

See [CONCEPTS.md](CONCEPTS.md) for an overview of the profile-centered
configuration hierarchy (profile template → profile → per-VM registry metadata)
and typical workflows.

## State directory

By default psbx stores all state (config, profiles, registry) under
`~/.psbx`. Set the environment variable `PSBX_HOME` to use a
different root location. In the following we refer to the default value
for simplicity. The directory structure is:

```md
~/.psbx/
├── config.json
└── profiles/
    └── <profile_name>/
```

## Global config

The only global JSON config file is `~/.psbx/config.json`. It contains
shared psbx state settings. The top-level keys are:

| Field | Purpose | Manage sub-commands | Inspection sub-commands |
|---|---|---|---|
| `defaultProfile` | Profile used by lifecycle commands when `--profile` is omitted | `profile set-default` | `profile list` |
| `vms` | Registry of project VM metadata managed by psbx | `up`, `stop`, `restart`, `delete` | `list`, `status` |
| `caches` | Registry of hidden profile cache VMs managed by psbx | `cache delete [--all]` | `cache list`, `cache status` |

For debugging and experimentation, you can inspect the current project VM's profile env with `status` (or `status --json`). Edit it in the profile with `profile edit --file env`.

## Profiles

Profiles live under:

```text
~/.psbx/profiles/<profile_name>/
├── env.yaml
├── lima.schema.json
├── lima.yaml
├── TODO needs cop
├── provision-system.sh
├── provision-user.sh
└── ... agent-specific subdirectories
```

`env.yaml` declares the host-config subfolders the profile owns. Each entry
is mounted read-only into the VM at `/mnt/host-config/<name>` and includes the
guest path used by finalization and `profile fork`. It also lists which host
environment variables to forward.

Example for the default `pi-in-ubuntu` profile template:

```yaml
configMounts:
  - source: pi/agent
    name: agent
    guestTarget: ~/.pi/agent
    sessions:
      workspacePath: .agents/pi-sessions
      guestSymlink: ~/.pi/agents/sessions

shellEnvAllowlist:
  # - GHE_MCP_TOKEN
```

Example for the `copilot-in-ubuntu` profile template:

```yaml
configMounts:
  - source: copilot
    name: copilot
    guestTarget: ~/.copilot
    sessions:
      workspacePath: .agents/copilot-sessions/session-state
      guestSymlink: ~/.copilot/session-state
    exfiltrateExcludes: [session-state, session-store.db, logs, ide]

shellEnvAllowlist:
  # - COPILOT_GITHUB_TOKEN
```

Example for the `opencode-in-ubuntu` profile template:

```yaml
configMounts:
  - source: opencode
    name: opencode
    guestTarget: ~/.config/opencode
    sessions:
      workspacePath: .agents/opencode-sessions
      guestSymlink: ~/.config/opencode/sessions
    exfiltrateExcludes: [sessions, logs]

shellEnvAllowlist:
  # - ANTHROPIC_API_KEY
  # - OPENAI_API_KEY
```

### `configMounts` fields

| Field | Required | Purpose |
|---|---|---|
| `source` | yes | Profile-relative path to the host config directory. |
| `name` | yes | Mount-point segment under `/mnt/host-config/<name>`. Must match `[A-Za-z0-9._-]+`. |
| `guestTarget` | yes | Absolute or `~`-prefixed path inside the VM that finalization should populate from the mount. Used by `profile fork` to know where to read back. |
| `sessions.workspacePath` | no | Workspace-relative directory created under the project (e.g., `.agents/pi-sessions`). When `sessions.guestSymlink` is also set, this is where the symlink points. |
| `sessions.guestSymlink` | no | Absolute or `~`-prefixed guest path that finalization replaces with a symlink to `sessions.workspacePath`. Any existing file or directory at this path is removed first. |
| `exfiltrateExcludes` | no | Subpath names to drop after `profile fork` copies the guest target back into the new profile. |

`source` and `sessions.workspacePath` must be relative paths that stay inside the
profile directory and project directory respectively; absolute paths and `..`
segments are rejected.

A default profile is set automatically when you create your first profile, or explicitly via `psbx profile set-default <profile-name>`. It is used when `psbx up` is called without an explicit `--profile` argument. The name of the default profile is stored in `~/.psbx/config.json`, alongside information about the currently created VMs that are under management of psbx.

Create a profile with:

```bash
psbx profile init <profile-name>
```

Additional initialization modes:

```bash
psbx profile init work --from-profile default
psbx profile init nested-test --self-test
psbx profile init copilot --template copilot-in-ubuntu
psbx profile fork work-local   # from the running current-project VM
```

`profile fork` snapshots the current VM's registered profile plus exfiltrated
`configMounts` guest contents into the new profile, then rebases the current VM
registry entry to that profile. The current project VM must be running; no
restart or recreate is performed, and the cache key stays the same when the Lima
config is unchanged.

### `shellEnvAllowlist` entries

The `shellEnvAllowlist` key in `env.yaml` lists host environment variables
forwarded into the VM shell, e.g.:

```yaml
shellEnvAllowlist:
  - COPILOT_GH_HOST
  - COPILOT_GITHUB_TOKEN
```

`up` and `exec` read the list live from the VM's registered profile and pass
only those current host variables through to Lima. The registry stores an
informational hash for visibility, not the allowlist itself.

Variable names must match:

```text
[A-Za-z_][A-Za-z0-9_]*
```

## Lima YAML

`lima.yaml` is a normal Lima config. psbx loads it, resolves profile-relative `provision[].file` paths, then adds dynamic read/write mounts:

| Host | Guest | Writable |
|---|---|---|
| Current project directory | `~/workdir` | Yes |
| Each profile config subfolder declared in `env.yaml`, resolved through symlinks | `/mnt/host-config/<name>` | No |

Profile provisioning scripts should be referenced with Lima-native `file` entries:

```yaml
provision:
  - mode: system
    file: ./provision-system.sh
  - mode: user
    file: ./provision-user.sh
```

Provisioning scripts are cache-time scripts. They should install tools and
configure the base guest only. Project-specific work such as waiting for
`~/workdir`, copying `/mnt/host-config/<name>` into the guest target, and linking
session directories is performed by psbx finalization after cloning.

### Configuration precedence

The effective Lima config for VM creation is resolved in this order:

1. Profile `lima.yaml`
2. Project-specific `<project>/.psbx/lima.yaml`
3. Extra `psbx up -- <limactl start args...>` arguments

The project YAML is intentionally restricted to:

```yaml
cpus: 8
memory: "16GiB"
disk: "80GiB"
```

Any other top-level key is rejected before VM creation. Extra arguments after `--` are not inspected by psbx and are forwarded to `limactl start`. Because these arguments are opaque creation-time inputs, they bypass the profile cache for that VM creation.

Example one-off Lima override (bypasses VM caching):

```bash
psbx up -- --cpus=6 --memory=12GiB
```

### Host CA certificate injection

Use Lima-native `caCerts.files`:

```yaml
caCerts:
  files:
    - "~/path/to/my-corporate-ca.pem"
```

This injects host CA certificates into the VM trust store. Corporate proxy CAs are the most common reason to enable it.

## Pi agent configuration

Everything under `~/.psbx/profiles/<profile>/pi/agent` is mounted read-only at `/mnt/host-config/agent` and copied into the guest as `~/.pi/agent` during project VM finalization. This can include, but is not limited to:

| Content | Reference |
|---|---|
| `skills/` | https://pi.dev/docs/latest/skills |
| `extensions/` | https://pi.dev/docs/latest/extensions |
| `keybindings.json` | https://pi.dev/docs/latest/keybindings |
| `settings.json` | https://pi.dev/docs/latest/settings |
| `auth.json`, `models.json` | https://pi.dev/docs/latest/authentication |
| `mcp.json` | https://pi.dev/packages/pi-mcp-adapter |

None of these files are required from psbx's perspective. Session persistence is handled by symlinking `~/.pi/agents/sessions` inside the VM to `~/workdir/.agents/pi-sessions` in the project directory, so pi session history survives VM rebuilds.

The profile `pi/agent` directory may be a symlink to `~/.pi/agent`. psbx resolves and mounts the symlink target read-only, then copies its contents into the VM.

The host profile is not mutated by the VM. Changes made inside the guest to `~/.pi/agent` last only for the lifetime of that VM. Persist configuration changes by writing them under `~/workdir/.agents`, manually copying them back to the host profile, or forking the running VM into a new profile:

```bash
psbx profile fork new-profile
```

## OpenCode configuration

The `opencode-in-ubuntu` profile template installs
[OpenCode](https://opencode.ai/) in the VM. Create a profile with:

```bash
psbx profile init opencode --template opencode-in-ubuntu
cp -a ~/.config/opencode/.    ~/.psbx/profiles/opencode/opencode/   # optional
```

The profile mounts the OpenCode config directory:

| Profile path | Guest mount | Guest target | Notes |
|---|---|---|---|
| `opencode/` | `/mnt/host-config/opencode` (read-only) | `~/.config/opencode` | Follows the upstream [`~/.config/opencode` layout](https://opencode.ai/docs/config/) (e.g., `opencode.json`). |

During project VM finalization the directory is copied to `~/.config/opencode`
in the guest. To keep session history with the project,
`~/.config/opencode/sessions` is replaced with a symlink to
`~/workdir/.agents/opencode-sessions`.

`profile fork <new-profile>` exfiltrates `~/.config/opencode` back into the
new profile but excludes `sessions` and `logs` (declared via
`exfiltrateExcludes` in `env.yaml`) so workspace session history is not
duplicated into the profile.

## GitHub Copilot CLI configuration

The `copilot-in-ubuntu` profile template installs the
[GitHub Copilot CLI](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference)
in the VM. Create a profile with:

```bash
psbx profile init copilot --template copilot-in-ubuntu
cp -a ~/.copilot/.            ~/.psbx/profiles/copilot/copilot/   # optional
```

The profile mounts the Copilot config directory:

| Profile path | Guest mount | Guest target | Notes |
|---|---|---|---|
| `copilot/` | `/mnt/host-config/copilot` (read-only) | `~/.copilot` | Follows the upstream [`~/.copilot` layout](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference) (e.g., `settings.json`, `mcp-config.json`, `agents/`, `instructions/`, `skills/`, `hooks/`). |

During project VM finalization the directory is copied to `~/.copilot` in the
guest. To keep session history with the project, `~/.copilot/session-state` is
replaced with a symlink to `~/workdir/.agents/copilot-sessions/session-state`.

`profile fork <new-profile>` exfiltrates `~/.copilot` back into the new profile
but excludes `session-state`, `session-store.db`, `logs`, and `ide` (declared
via `exfiltrateExcludes` in `env.yaml`) so the workspace's session history is
not duplicated into the profile.
