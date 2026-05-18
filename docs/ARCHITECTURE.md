# Architecture

See [CONCEPTS.md](CONCEPTS.md) for an overview of the profile-centered
configuration hierarchy (profile template → profile → per-VM registry metadata).

## Components

| Module | Responsibility |
|---|---|
| `bin/pi-sandbox.js` | Defines CLI commands and the limited profile-aware command surface. |
| `src/config.js` | Loads global config, resolves profile directories, parses `env.yaml`, and derives VM names. |
| `src/template.js` | Parses profile and project Lima YAML, deep-merges safe overrides, resolves provisioning file paths, adds dynamic mounts (project workdir + each profile config subfolder), and serializes the final Lima config. |
| `src/cache.js` | Builds/reuses hidden clone source VMs for effective profile cache keys and creates project VMs with `limactl clone`. |
| `src/commands/cache.js` | Lists profile cache VMs and deletes either the current project's matching cache or all registered caches. |
| `src/finalize.js` | Runs lightweight per-project finalization after clone/start: config copy, session directory setup, Copilot session symlink, and clone identity cleanup. |
| `src/validate.js` | Checks Lima availability, profile files, project override allowlist, and environment variable names. |
| `src/lima.js` | Wraps `limactl` subprocess calls. |
| `src/registry.js` | Stores VM and profile-cache metadata needed by commands that do not accept profile options. |

## Profile source of truth

Profiles are directories under `~/.pi-sandbox/profiles`. The directory name is the profile name. The profile owns:

1. Lima configuration in `lima.yaml`
2. Environment passthrough and config-mount declarations in `env.yaml`
3. Host-config subfolders referenced by `env.yaml#configMounts` (e.g., `pi/agent`, `copilot`)

`config.json` stores the default profile plus per-VM and cache metadata; profile files remain the source of truth for Lima and env settings. The pi-sandbox state directory defaults to `~/.pi-sandbox` and can be overridden with the `PI_SANDBOX_HOME` environment variable.

## YAML generation

pi-sandbox does not interpolate YAML text. For project VMs it:

1. Parses the profile `lima.yaml`.
2. Parses `<project>/.pi-sandbox/lima.yaml` if it exists.
3. Rejects project YAML keys except `cpus`, `memory`, and `disk`.
4. Deep-merges the project YAML over the profile YAML.
5. Resolves relative `provision[].file` paths against the profile directory.
6. Adds the project mount at `~/workdir`.
7. Adds one read-only mount per `env.yaml#configMounts` entry that exists on disk: `<profileDir>/<source>` → `/mnt/host-config/<name>`.
8. Serializes the object to a temporary `lima.yaml` in a private temp directory.

Extra arguments passed to `pi-sandbox up -- ...` are forwarded to `limactl start` after pi-sandbox has generated the YAML, so Lima handles their precedence.

For profile cache VMs, pi-sandbox performs steps 1-5 and serializes the result
without adding project/config dynamic mounts. This keeps project paths and
profile config directory contents out of the reusable cache.

## Profile cache

Normal VM creation is clone-backed:

1. Compute a profile cache key from cache-safe inputs: effective profile Lima
   config, project `cpus`/`memory`/`disk` overrides, provision file contents,
   Lima version, and CA certificate file contents.
2. Ensure a stopped hidden cache VM named `pi-cache-<cacheKey[0..12]>` exists.
3. `limactl clone` the cache VM to the project VM name.
4. Merge `~/workdir` and `/mnt/host-config/<name>` mounts into the clone's
   already-expanded instance `lima.yaml`.
5. Start the clone and run finalization.

Cache keys intentionally exclude `defaultCmd`, `shellEnvAllowlist`, current host
environment values, project paths, and profile config directory contents. Those
values are runtime or per-project inputs and are read from the profile and
applied by shell entry/finalization instead. Project VM metadata records a
separate finalizer hash that does include copied profile config contents, so
profile config edits re-run finalization in place without rebuilding the
expensive base or restarting the VM.

When opaque extra `limactl` creation arguments are supplied after `--`,
pi-sandbox bypasses the cache and creates directly because those arguments may
affect creation-time state that cannot be safely reconstructed after cloning.

## Mount strategy

| Host | Guest | Access | Why |
|---|---|---|---|
| Current project directory | `~/workdir` | Read-write | Code changes, project files, and `~/workdir/.agents` must persist. |
| Each profile config subfolder (`env.yaml#configMounts[].source`) | `/mnt/host-config/<name>` | Read-only | Host profile is the source of truth and should not be mutated by the VM. |

Project finalization copies each `/mnt/host-config/<name>` into the matching guest target (e.g., `~/.pi/agent`, `~/.copilot`). The copy lets agents mutate auth and settings inside the VM without writing back to the host profile.

## Environment passthrough

The profile `env.yaml` remains the source of truth. `up` and `exec` resolve the
registered profile name, read `shellEnvAllowlist` live, and invoke Lima with:

```text
LIMA_SHELLENV_BLOCK=*
LIMA_SHELLENV_ALLOW=<comma-separated profile values>
```

If the registered profile is missing, `exec` still works but forwards no host
environment variables and prints a warning. This keeps non-profile commands
deterministic and prevents accidental forwarding of the host environment.

## VM-local and persistent pi data

`~/.pi/agent` is copied into the VM and is VM-local. `~/workdir/.agents` is inside the writable project mount and persists on the host. Project finalization rewrites `settings.json` to store sessions at `~/workdir/.agents/sessions`.

## Registry

The registry lives in `~/.pi-sandbox/config.json` under the top-level `vms` key. Each entry stores the host project directory, registered profile name, cache metadata, and split hashes used for drift detection:

```json
{
  "my-project": {
    "projectDir": "/Users/me/projects/my-project",
    "profile": "default",
    "profileCacheName": "pi-cache-1a2b3c4d5e6f7",
    "profileCacheKey": "1a2b3c4d5e6f...",
    "finalizerStatus": "complete",
    "limaConfigHash": "<sha256 of rendered project lima.yaml>",
    "finalizerHash": "<sha256 of finalizer inputs>",
    "shellEnvAllowlistHash": "<sha256, informational>",
    "defaultCmdHash": "<sha256, informational>"
  }
}
```

There is no per-VM `env` blob. On first read, old `env`/`envHash` fields are silently dropped. `limaConfigHash` changes prompt a recreate; this includes profile `lima.yaml` changes and config mount add/remove/rename changes. `finalizerHash` changes re-run the idempotent finalizer in place with no restart; this includes config mount source contents, `projectSessionDir`, `guestTarget`, `source`, and fields on existing mounts. `shellEnvAllowlistHash` and `defaultCmdHash` are stored for visibility only; `exec` and `up` read those values live from the profile. `configMounts[].exfiltrateExcludes` is also read live when exfiltrating.

Profile cache metadata lives in the same file under `caches`. Each cache entry
stores the cache key, Lima version, creation timestamp, and a `status` of
`ready` or `failed`. Cache names are content-addressed, so profiles with
identical rendered cache Lima YAML share a cache. Cache GC removes any cache
not referenced by a live registry VM. When cache provisioning fails, the
failed cache VM is kept (registered with `status: 'failed'`) so its cloud-init
log can be inspected via `pi-sandbox logs`; the next `pi-sandbox up` deletes
and rebuilds it. `pi-sandbox cache status` computes the current project's
cache key using the registered project profile when available, otherwise the
default profile.
