# Concepts: Profile Templates, Profiles, and Registry Metadata

psbx uses a profile-centered configuration hierarchy that separates
**shipped defaults**, **user customizations**, and **per-VM runtime metadata**.

## The three tiers

```
┌─────────────────────────────────────────────────────┐
│              Profile Template (shipped)              │
│                                                     │
│  Read-only blueprints bundled with psbx.      │
│  Location: templates/profiles/<name>/               │
│                                                     │
│  Examples: pi-in-ubuntu, copilot-in-ubuntu,         │
│            self-test                                 │
└────────────────────┬────────────────────────────────┘
                     │  psbx profile init <name>
                     │  --template <template>
                     ▼
┌─────────────────────────────────────────────────────┐
│                   Profile (user)                     │
│                                                     │
│  User-owned copies in ~/.psbx/profiles/.      │
│  Editable with `psbx profile edit`.           │
│  One profile can serve many projects/VMs.           │
│                                                     │
│  Contains: lima.yaml, env.yaml, config dirs         │
│            (pi/agent, copilot, etc.)                │
└────────────────────┬────────────────────────────────┘
                     │  psbx up [--profile <name>]
                     │  (registry records profile + hashes)
                     ▼
┌─────────────────────────────────────────────────────┐
│             Registry Metadata (per VM)               │
│                                                     │
│  Stored in ~/.psbx/config.json under          │
│  vms.<vm-name>.                                     │
│  (Override root with PSBX_HOME)               │
│                                                     │
│  Ties a VM to a profile and records change hashes.  │
│  The profile remains the source of truth.           │
└─────────────────────────────────────────────────────┘
```

## Definitions

### Profile template

A **profile template** is a read-only, shipped blueprint that provides
sensible defaults for a particular agent or workflow. Profile templates
live in the `templates/profiles/` directory of the psbx installation
and cannot be modified by the user.

Shipped profile templates:

| Template | Default command | What it provides |
|---|---|---|
| `pi-in-ubuntu` | `pi` | Ubuntu VM with pi agent configuration |
| `copilot-in-ubuntu` | `copilot` | Ubuntu VM with GitHub Copilot CLI support |
| `self-test` | _(none)_ | Lightweight Alpine VM for testing |

### Profile

A **profile** is a user-owned directory under `~/.psbx/profiles/<name>/`.
It is created from a profile template, copied from an existing profile, or
forked from a running VM. A single profile can be the basis for VMs in many
different projects.

A profile contains:

| File/Dir | Purpose |
|---|---|
| `lima.yaml` | Lima VM configuration (CPU, memory, disk, provisioning scripts) |
| `env.yaml` | Runtime environment: default command, env var allowlist, config mounts |
| `pi/agent/` | Pi agent configuration files (optional) |
| `copilot/` | Copilot configuration files (optional) |

Profiles are the right place for anything that should be **shared across
projects** but **customizable per user**: agent auth tokens, editor settings,
provisioning scripts, resource limits.

### Env

The **env** is the profile-owned runtime configuration in `env.yaml`. It
contains three keys:

| Key | Type | Purpose |
|---|---|---|
| `defaultCmd` | string | Command to run when entering the VM (e.g. `pi`, `copilot`) |
| `shellEnvAllowlist` | string[] | Host environment variables forwarded into the VM shell |
| `configMounts` | object[] | Profile config directories mounted into the VM |

`psbx status` shows the env live through the VM's registered profile name.
There is no per-VM env override stored in the registry. If the registered
profile is missing, `status`, `up`, `up --only-recreate`, and
`up --force-recreate` fail with guidance to restore the profile or fork from a
peer; `exec`, `stop`, `delete`, and `logs` still work, with `exec`
forwarding no host env vars.

## Typical workflow

```
1. Initialize a profile from a shipped template
   ┌──────────────────────────────────────────┐
   │ $ psbx profile init work           │
   │   --template pi-in-ubuntu                │
   └──────────────────────────────────────────┘
           │
           ▼
2. Customize the profile (optional)
   ┌──────────────────────────────────────────┐
   │ $ psbx profile edit work           │
   │   # edit lima.yaml, env.yaml,            │
   │   # add auth tokens, tweak resources     │
   └──────────────────────────────────────────┘
           │
           ▼
3. Start a VM in a project directory
   ┌──────────────────────────────────────────┐
   │ $ cd ~/projects/my-app                   │
   │ $ psbx up --profile work           │
   │   # records profile name + hashes        │
   └──────────────────────────────────────────┘
           │
           ▼
4. Work in the VM (enter, exec, restart...)
   ┌──────────────────────────────────────────┐
   │ $ psbx up      # re-enter          │
   │ $ psbx exec -- npm test            │
   │ $ psbx restart                     │
   └──────────────────────────────────────────┘
           │
           ▼
5. Inspect or change profile env
   ┌──────────────────────────────────────────┐
   │ $ psbx status                      │
   │ $ psbx profile edit work --file env│
   │   # exec/up read allowlist/defaultCmd    │
   │   # live from the profile                │
   └──────────────────────────────────────────┘
           │
           ▼
6. Fork VM-local config into a new profile
   ┌──────────────────────────────────────────┐
   │ $ psbx profile fork work-local     │
   │   # requires this VM to be running;     │
   │   # no restart/recreate is performed     │
   └──────────────────────────────────────────┘
           │
           ▼
7. Reuse the same profile for another project
   ┌──────────────────────────────────────────┐
   │ $ cd ~/projects/other-app                │
   │ $ psbx up --profile work           │
   │   # creates a separate VM using the      │
   │   # same profile                         │
   └──────────────────────────────────────────┘
```

## Data flow diagram

```
  Profile Template                 Profile                      Registry (per-VM)
  (shipped, read-only)            (user, source of truth)       (metadata only)
  ──────────────────              ───────────────────────       ───────────────

  templates/profiles/             ~/.psbx/profiles/work/  config.json → vms.my-app
  └── pi-in-ubuntu/               ├── lima.yaml ──────────┐     ├── profile: work
      ├── lima.yaml     ──copy──▶ ├── env.yaml ───────┐   │     ├── limaConfigHash
      ├── env.yaml                ├── pi/             │   │     ├── finalizerHash
      └── pi/                     │   └── agent/      │   │     ├── shellEnvAllowlistHash
          └── agent/              └── copilot/        │   │     └── defaultCmdHash
                                                      │   │
                                           env.yaml ──┘   └────▶ rendered lima.yaml
                                           parsing                    │
                                              │                      ▼
                                              ▼                   limactl
                                   status / exec / up
                                   (read live from profile)
```

## Change detection

| Profile change | Hash flipped | Action |
|---|---|---|
| `lima.yaml` fields; config mount add/remove/rename | `limaConfigHash` | recreate (with confirm prompt) |
| config mount source contents; `projectSessionDir`; `guestTarget`; `source`; `name` of an existing mount | `finalizerHash` | re-run idempotent finalizer in place; no restart |
| `configMounts[].exfiltrateExcludes` | — | read live at exfiltrate time |
| `shellEnvAllowlist` | `shellEnvAllowlistHash` (informational) | none — read live by `exec` and `up` |
| `defaultCmd` | `defaultCmdHash` (informational) | none — read live by `up` |

## When to use what

| I want to... | Use |
|---|---|
| Start with defaults for a new agent setup | `profile init --template <name>` |
| Customize VM resources, provisioning, or agent config | `profile edit <name>` |
| Share one setup across many projects | Use the same `--profile` with `up` in each project |
| Inspect the env a VM reads from its profile | `status` or `status --json` |
| Change env for all VMs using a profile | `profile edit <name> --file env` |
| Snapshot a running VM's current profile plus guest config into a new reusable profile | `profile fork <new-name>` |
