# Security

This document describes the trust boundaries psbx enforces, what is explicitly out of scope, and how host data flows into and out of the VM.

## Trust model

psbx assumes **the host is trusted and the VM guest is untrusted**. The design prevents the guest from modifying host state beyond the project's own directory.

### Trust boundaries

| Boundary | Enforcement |
|---|---|
| Host profile config dirs → VM | Each subfolder declared in `env.yaml#configMounts` is copied **one-way** into the corresponding guest target (e.g., `~/.pi/agent`, `~/.copilot`) during finalization, host-side via `limactl copy` (symlinks resolved on the host). The host profile is never mounted, so the VM has no live view of it and cannot write back. |
| Host project directory → VM | Mounted **read-write** at `~/workdir`. The agent needs write access to modify project files. |
| Host environment → VM | **Explicit opt-in only.** Only variables listed in `env.yaml#shellEnvAllowlist` are forwarded; all others are blocked via `LIMA_SHELLENV_BLOCK=*`. |
| Project Lima overrides | Restricted to `cpus`, `memory`, and `disk`. A project cannot override mounts, provisioning, networking, or other security-relevant Lima settings. |
| `.agents` directory in project | psbx refuses to create state inside `.agents` if it is a symlink, preventing symlink-based path traversal. |
| Profile cache VM → project VM | The hidden cache VM is built without project mounts or profile config mounts. Before it is stopped for cloning, psbx removes clone-sensitive guest identity files such as SSH host keys and machine-id. |

### Data flow summary

```text
Host                                    VM Guest
─────────────────────────────────────── ───────────────────────────────
~/.psbx/profiles/<p>/<configMount.source> ──► <guestTarget> (VM-local, one-way copy)
<project>/ ◄────────────────────────►   ~/workdir (RW)
                                        └─ ~/workdir/.agents/<tool>-sessions (persistent, via sessions.guestSymlink)
shellEnvAllowlist variables ───────────► LIMA_SHELLENV_ALLOW (filtered)
profile cache VM ──────────────────────► cloned disk without project/profile config data
```

### Importing host config at profile creation

`psbx profile init --copy-from-host` copies the host config directories
declared by `configMounts` into the new profile **with symlinks dereferenced**
(`cpSync(..., { dereference: true })`). This means a symlink inside a host
config dir that points outside it (e.g. a linked `~/.ssh/id_*` or a credentials
file) has its *contents* copied into the profile — and later mounted into the
VM. `exfiltrateExcludes` are opt-in and path-specific, so links you are not
aware of would otherwise leak by default. To make this visible, psbx warns for
each symlink whose target escapes the source directory during the copy; review
the warnings before reusing or sharing the profile. `--symlink-from-host`
instead links the host directory into the profile (no copy), so its contents
are never duplicated into the profile tree.

## Non-goals

psbx is **not** a security sandbox in the container-hardening sense. The following are explicitly out of scope:

| Non-goal | Rationale |
|---|---|
| Protection against a malicious guest escaping the VM | Lima VMs rely on the host hypervisor (Apple Virtualization.framework, QEMU). psbx adds no additional confinement beyond what Lima provides. |
| Network isolation | The VM has full outbound network access by default. Restrict it via Lima's `networks` configuration in the profile `lima.yaml` if needed. |
| Multi-tenant isolation | psbx is designed for single-user developer workstations, not shared infrastructure. |
| Secrets management | API tokens in `shellEnvAllowlist` are passed as environment variables. They are visible to any process inside the VM. Use short-lived tokens where possible. |
| Tamper-proof audit logging | Provisioning logs are stored inside the VM; a compromised guest could modify them. |
| Hardened supply chain for provisioning | Provisioning scripts download packages over HTTPS from public registries (apt, npm, GitHub). The scripts are not pinned to specific hashes by default. Pin images and package versions in your profile for stronger reproducibility. |

## Recommendations

- **Limit tokens.** Only pass the minimum set of environment variables needed for the task. Use scoped, short-lived API tokens.
- **Pin images.** For reproducible and auditable builds, uncomment the `images` block in `lima.yaml` and pin a specific image digest.
- **Pin the agent package.** The default provisioning scripts install `@earendil-works/pi-coding-agent` from npm without a version pin (`npm install -g @earendil-works/pi-coding-agent`). To lock a specific version, edit `provision-system.sh` in your profile, e.g. `npm install -g @earendil-works/pi-coding-agent@1.2.3`.
- **Keep cache provisioning generic.** Do not copy secrets or project data in profile provisioning scripts. Let psbx finalization copy profile config into each project VM after cloning.
- **Review provisioning scripts.** Treat the profile `provision-*.sh` scripts as part of your security surface. They run as root during VM creation.
- **Keep Lima updated.** VM escape vulnerabilities in the hypervisor layer are mitigated by staying on the latest Lima and host OS releases.
- **Use project overrides sparingly.** A project's `.psbx/lima.yaml` can only adjust resource limits (`cpus`, `memory`, `disk`), which is safe. Do not relax this allowlist.
