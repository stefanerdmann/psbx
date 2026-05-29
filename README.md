# psbx — Project Sandbox

`psbx` (project sandbox) is a thin wrapper to manage a development VM per project. Mainly focused on running agents like the [pi coding agent](https://pi.dev/) in a storage-isolated environment. psbx gives each project its own [Lima](https://lima-vm.io) VM with your agent configuration, API tokens, and project files ready to go, while keeping the host system clean and preventing cross-project interference.

**Key benefits:**

- **Isolation** — each project runs in its own VM; agent activity cannot affect the host or other projects.
- **Reproducibility** — profiles capture the full environment (OS, packages, agent config) so you can recreate identical sandboxes at will.
- **Simplicity** — a single `psbx up` command creates, starts, and enters the sandbox.

## Prerequisites

| Requirement | Install | Why |
|---|---|---|
| **Lima** | `brew install lima` | Manages the Linux VMs |
| **Node.js ≥ 26** | `brew install node` | Runs the psbx CLI directly from its TypeScript sources via Node's built-in type stripping (no build step) |

## Install

psbx is not published on npm. Clone the repository and install from the
checkout:

```bash
git clone https://github.com/stefanerdmann/psbx.git
cd psbx
npm install  # installs dependencies and compiles TypeScript → dist/
npm install --global --install-links .  # installs psbx CLI globally
```

On Linux, the global install step may require `sudo`.

## Quick start

This quick start uses [pi coding agent](https://pi.dev/). See [Concepts](#concepts) for other agent templates and customization.

First create a profile:
```bash
psbx profile init <profile-name>
```
If you have a pi configured on the host `~/.pi/agent/.`, you can optionally add the flags
`--copy-from-host` or `--symlink-from-host`.

Then launch a sandbox from any project directory:
```bash
cd ~/projects/my-project
psbx up
```
You land in `~/workdir` inside the VM, which is your host project directory mounted read-write.
The pi coding agent starts automatically.

## Concepts

psbx uses a profile-centered configuration hierarchy:

1. **Profile templates** (shipped) — read-only blueprints bundled with psbx
2. **Profiles** (user) — customizable copies under `~/.psbx/profiles/` and the source of truth for Lima and env settings
3. **Registry metadata** (per-VM) — project/profile binding and hashes in `config.json`

You start from one of the shipped profiles that can be selected during `psbx profile init --template ...`

- `pi-in-ubuntu`: default; used in the quick-start,
- `copilot-in-ubuntu` geared towards usage of GitHub Copilot CLI instead of pi, or
- `opencode-in-ubuntu` geared towards usage of [OpenCode](https://opencode.ai/) instead of pi.

For details, see [Pi agent configuration](docs/CONFIG.md#pi-agent-configuration), [GitHub Copilot CLI configuration](docs/CONFIG.md#github-copilot-cli-configuration), and [OpenCode configuration](docs/CONFIG.md#opencode-configuration) in the Configuration Reference.

After initialization, you should `psbx profile edit <profile-name>` to adapt
the profile to your needs. This profile then defines the common configuration as many
project-specific VMs you like to create. You can create multiple independent profiles
to serve different kinds of use-cases.

Changes to a profile trigger VM recreation on next `psbx up` for projects using
that profile (as detected by comparison to the registry metadata).

See [docs/CONCEPTS.md](docs/CONCEPTS.md) for a detailed explanation with
diagrams and typical workflows.

## Common Profile Customizations

See [docs/CONFIG.md](docs/CONFIG.md) for a detailed explanation of the provided
configuration options. Here, we list two typical customizations. Edit Lima settings with

```bash
psbx profile edit <profile-name> [--file lima|env]
```

### How do I pass through environment variables?

Profiles declare host environment variables to pass into the sandbox shell via the `shellEnvAllowlist` key in `env.yaml`, e.g.:

```yaml
shellEnvAllowlist:
  - GHE_MCP_TOKEN
  - GITHUB_MCP_TOKEN
```

`psbx up` and `psbx exec` read this allowlist from the registered profile.

### How can I use a host CA certificate?

This is commonly needed in corporate environments where HTTPS traffic is re-signed by an internal CA.
You can inject a host CA certificates into the VM with Lima-native `caCerts.files` in the profile `lima.yaml`:

```yaml
caCerts:
  files:
    - "~/path/to/my-corporate-ca.pem"
```

### Where are my profiles stored?

All state, including profile configuration, lives under `~/.psbx` by default.
You can set `PSBX_HOME` to use a different location, e.g.:

```bash
export PSBX_HOME="${XDG_CONFIG_HOME:-$HOME/.config}/psbx"
```

## Lima configuration precedence

VM creation merges Lima settings from the profile, an optional project-level
override (`<project>/.psbx/lima.yaml`, limited to `cpus`/`memory`/`disk`),
and any extra `psbx up -- <args>` passed to `limactl start`.
See [docs/CONFIG.md — Configuration precedence](docs/CONFIG.md#configuration-precedence)
for the full resolution order and examples.

## Profile VM cache

`up` uses a transparent Lima clone-backed cache for normal VM creation. On the
first create for a profile/cache key, psbx prepares a hidden stopped Lima
instance named like `psbx-cache-<cacheKey[0..12]>`. Later project VMs using the same
effective cache key are created with `limactl clone`, then finalized for the
current project.

The cache key is derived from the rendered cache Lima YAML and includes
cache-safe VM-shaping inputs: profile `lima.yaml`, project
`cpus`/`memory`/`disk` overrides, referenced provisioning script contents, Lima
version, and configured CA certificate file contents. It intentionally excludes
project paths, profile config directory contents, `defaultCmd`,
`shellEnvAllowlist`, and current host environment values. Two profiles with
identical cache Lima config share one cache. New VMs receive current profile
config during finalization; existing VMs re-run finalization in place when
copied profile config content changes.

Opaque extra arguments after `--` bypass the cache because psbx cannot know
which creation-time state they affect.

Inspect and manage caches with:

```bash
psbx cache list              # alias: cache ls
psbx cache status            # hit/miss for this project/profile cache key
psbx cache delete            # delete this project's matching cache
psbx cache delete --all      # delete every registered cache
```

`cache status` and `cache delete` use the current project's registered profile
when one exists, otherwise the default profile. Pass `--profile <name>` to check
or delete the cache key for a specific profile.

## Commands

| Command | Description | Key options |
|---|---|---|
| `psbx up` | Bring sandbox up: create, start, and enter in one step | `--profile <name>`, `--shell`, `--only-create`, `--only-recreate`, `--only-start`, `--force-recreate` |
| `psbx exec [-- cmd...]` | Run a one-off command in the sandbox (auto-starts if stopped) | `--shell` |
| `psbx profile init <profile>` | Create a new profile from a shipped profile template or existing profile | `--template <name>` (pi-in-ubuntu, self-test, copilot-in-ubuntu, opencode-in-ubuntu), `--from-profile <name>`, `--self-test`, `--copy-from-host`, `--symlink-from-host`, `--set-as-default` |
| `psbx stop` | Stop the VM | `-f, --force` |
| `psbx restart` | Stop and then start the VM | `-f, --force` |
| `psbx delete [vm-name]` | Delete a VM (defaults to current project) | `-f, --force`, `--all-registered` |
| `psbx cache list` | List caches (alias: `cache ls`) | |
| `psbx cache status` | Show whether the current project/profile has a matching cache | `--profile <name>` |
| `psbx cache delete` | Delete the current project/profile matching cache | `--profile <name>`, `-f, --force`, `--all` |
| `psbx profile delete [name]` | Delete a profile (warns if in use) | `-f, --force`, `--all` |
| `psbx profile list` | List all profiles (alias: `profile ls`) | |
| `psbx profile set-default <name>` | Set the default profile | |
| `psbx profile edit [profile]` | Open a profile in `$EDITOR` | `--file <file>` (lima, env, or relative path) |
| `psbx profile fork <new-profile>` | Snapshot the running current-project VM profile and guest config into a new profile, then rebase the VM to it without restart/recreate | |
| `psbx profile rename <src> <dest>` | Rename a profile, updating all references (default, VMs, caches) | `-f, --force` |
| `psbx status` | Show current project VM status, environment, and sync state | |
| `psbx list` | List registered VMs (alias: `ls`) | |
| `psbx logs` | Show cloud-init logs for the project and its cache VM (failed cache VMs are kept for inspection) | |
| `psbx completion [shell]` | Generate shell completion scripts (bash, zsh, fish) | |

Global option: `-y, --yes` skips confirmation prompts.

## Project hygiene

Running `psbx up` creates a `.agents/` directory (and optionally
`.psbx/lima.yaml`) in the project root. Consider adding these to your
`.gitignore`:

```gitignore
.agents/
.psbx/
```

## Development

The source is TypeScript and is executed **directly** — there is no
ahead-of-time transpile in the run path. psbx relies on Node's built-in
TypeScript support (type stripping) plus `.ts` import specifiers, so the
`>=26.0.0` engine constraint in `package.json` is intentional, not a typo: it
is the floor at which running `.ts` files (and importing them with explicit
`.ts` extensions) works unflagged. Type-only syntax is enforced via
`erasableSyntaxOnly` in `tsconfig.json`, which keeps the sources strippable.
During development you can therefore run `.ts` files directly — no compilation
step needed in the dev loop:

```bash
node bin/psbx.ts --help        # run directly from source
npm run typecheck                     # type-check without emitting
npm run build                         # compile to dist/ (for publish/install)
```

### Testing

psbx uses Node.js built-in test runner (`node --test`). Tests are split into two suites:

| Script | What it tests | Requirements |
|---|---|---|
| `npm run test:fast` | Static behaviour — CLI flags, profile init, error paths | Node.js only; no VM or Lima needed |
| `npm run test:slow` | Full VM lifecycle — create, start, shell, stop, delete | Lima installed and working |
| `npm test` | Both suites | Lima installed and working |

Run during development:

```bash
npm run test:fast        # seconds — safe to run anywhere
npm run test:slow        # minutes — creates and destroys real VMs
```

The lifecycle tests use a self-test profile. This is a lightweight Alpine-based VM configuration, using 2 CPUs, 512 MiB memory, and a small disk. It installs QEMU and Lima inside the guest for nested testing scenarios.

Create it manually for experimentation:

```bash
psbx profile init self-test --self-test
```

The lifecycle tests create the self-test profile automatically in a temporary home directory, so you do not need to set it up before running `npm run test:slow`.

## Further reading

- [Configuration Reference](docs/CONFIG.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Provisioning](docs/PROVISIONING.md)
- [Security](docs/SECURITY.md)
