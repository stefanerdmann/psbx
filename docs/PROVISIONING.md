# Provisioning

Profile provisioning scripts live inside each profile directory and are loaded by Lima with `provision[].file` entries in `lima.yaml`. psbx resolves relative file paths against the profile directory before calling `limactl start`.

Provisioning is split into two phases:

1. **Cache provisioning** runs once in a hidden profile cache VM. It should only
   do cache-safe work such as package installs, tool installs, shell setup, and
   OS configuration. It must not depend on `~/workdir`, copy
   `/mnt/host-config/*`, read passthrough environment variables, or write
   project-specific state.
2. **Project finalization** runs after a project VM has been cloned from the
   cache and started. psbx waits for `~/workdir`, creates declared
   `projectSessionDir` directories, copies each current profile config mount
   into the guest target, patches pi `settings.json#sessionDir`, fixes
   `auth.json` permissions, and links Copilot `session-state` into the project
   session directory.

## pi-in-ubuntu profile template

The shipped `pi-in-ubuntu` profile template contains:

```text
provision-system.sh
provision-user.sh
```

### System provisioning

The `pi-in-ubuntu` system script:

1. Waits for package-manager locks.
2. Installs base packages with apt (`ca-certificates`, `curl`, `git`, `xz-utils`).
3. Installs Node.js LTS and symlinks the binaries into `/usr/local/bin`.

Host CA certificate injection is not scripted. Configure it in `lima.yaml` with Lima-native `caCerts.files`.

### User provisioning

The `pi-in-ubuntu` user script:

1. Creates `~/.pi/agent`.
2. Sets an npm user prefix.
3. Installs `@earendil-works/pi-coding-agent` globally.
4. Updates `.bashrc` so global npm tools are on `PATH`, CA certificates are used, and new shells start in `~/workdir`.

The host profile is mounted read-only and is not mutated. Finalization copies
`/mnt/host-config/agent` into `~/.pi/agent`, creates or rewrites `settings.json` to use
`~/workdir/.agents/sessions`, and restricts `auth.json` permissions. The copied
`~/.pi/agent` directory is part of the VM. Changes there are lost when the VM is
deleted unless copied back to the host profile or exfiltrated into a new
profile with `psbx profile fork <profile>`.

## copilot-in-ubuntu profile template

The `copilot-in-ubuntu` profile template installs the [GitHub Copilot CLI](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference) on the same Ubuntu base.

Create it with:

```bash
psbx profile init copilot --template copilot-in-ubuntu
```

User-side cache provisioning:

1. Creates `~/.copilot`.
2. Installs `@github/copilot` globally.
3. Updates `.bashrc` so global npm tools are on `PATH`, CA certificates are used, and new shells start in `~/workdir`.

Project finalization copies `/mnt/host-config/copilot` → `~/.copilot` and
replaces `~/.copilot/session-state` with a symlink to
`~/workdir/.agents/copilot-sessions` so Copilot session history persists in the
project directory.

`psbx profile fork <name>` exfiltrates `~/.copilot` back into the new profile, but skips `session-state`, `session-store.db`, `logs`, and `ide` so workspace-bound data stays in the workspace.

## self-test profile template

The self-test profile template uses an Alpine base image, 2 CPUs, 512MiB memory, and a small disk. Its system provisioning installs QEMU and downloads the latest Lima release plus additional guest agents. It is intended for psbx self-test harnesses that need to run inside a VM, including on hosts that fall back to software emulation.

Create it with:

```bash
psbx profile init self-test --self-test
```

## Re-provisioning

Lima cache provisioning runs when the profile cache is built. Project finalization
runs each time a project VM is created or recreated from the cache. To apply profile changes that affect `lima.yaml` or config mount topology to an existing VM, recreate it:

```bash
psbx up --only-recreate --profile <profile>
```

Project files and `~/workdir/.agents` persist because they live in the host project directory. VM-local state outside the project mount is discarded when the VM is recreated. Config mount content changes that do not affect Lima topology re-run finalization in place without a restart.
