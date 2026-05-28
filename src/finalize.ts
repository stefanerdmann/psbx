/**
 * VM finalization scripts.
 *
 * Two distinct shell payloads live here:
 *
 *   1. `CLONE_IDENTITY_FINALIZER` + `profileConfigFinalizerScript()` — run
 *      on every project VM after clone/create. Materializes profile config
 *      mounts into the guest home, creates session directories, and
 *      symlinks session paths into the project workdir via the
 *      `sessions[].guestSymlink` config. On a cloned VM also regenerates
 *      SSH host keys once.
 *
 *   2. `CACHE_SYSPREP_SCRIPT` — runs once at the end of cache provisioning
 *      to strip clone-unsafe identity (machine-id, SSH host keys) and
 *      install a boot-time regenerator. Bumping `CACHE_SYSPREP_VERSION`
 *      invalidates all existing caches.
 *
 * `shellQuote` (from `utils.ts`) is a POSIX-safe single-quoting helper used to inject paths
 * into the generated shell scripts.
 */

import { limaShellScript } from './lima.ts';
import { expandGuestHome, GUEST_WORKDIR, mountPointFor } from './template.ts';
import type { Profile } from './types.ts';
import { shellQuote, workspaceMkdirTarget } from './utils.ts';

function guestProjectPath(relativePath: string): string {
  return `${GUEST_WORKDIR}/${relativePath.replace(/^\.?\//, '')}`;
}

function profileConfigFinalizerScript(
  profile: Pick<Profile, 'configMounts' | 'sessions' | 'shadowPaths'>,
): string {
  const lines: string[] = [
    'set -eu',
    `until mountpoint -q ${shellQuote(GUEST_WORKDIR)}; do sleep 1; done`,
  ];

  // Pass 1: mkdir workdir session dirs
  for (const session of profile.sessions || []) {
    // Trailing slash → directory; no trailing slash → file (create parent only).
    lines.push(
      `mkdir -p ${shellQuote(guestProjectPath(workspaceMkdirTarget(session.workspacePath)))}`,
    );
  }

  // Pass 2: copy all config mounts
  for (const mount of profile.configMounts || []) {
    const source = mountPointFor(mount);
    const target = expandGuestHome(mount.guestTarget);
    lines.push(`mkdir -p ${shellQuote(target)}`);
    lines.push(
      `if [ -d ${shellQuote(`${source}/.`)} ]; then cp -a ${shellQuote(`${source}/.`)} ${shellQuote(target)}; fi`,
    );
  }

  // Pass 3: create all session symlinks
  for (const session of profile.sessions || []) {
    if (session.guestSymlink) {
      const sessionTarget = guestProjectPath(session.workspacePath);
      const symlinkPath = expandGuestHome(session.guestSymlink);
      lines.push(`rm -rf ${shellQuote(symlinkPath)}`);
      lines.push(`mkdir -p ${shellQuote(symlinkPath.replace(/\/[^/]+$/, ''))}`);
      lines.push(`ln -sfn ${shellQuote(sessionTarget)} ${shellQuote(symlinkPath)}`);
    }
  }

  // Pass 4: shadow paths — guest-local bind-mounts over workdir subdirectories
  for (const shadowPath of profile.shadowPaths || []) {
    const shadow = `/var/lib/psbx/shadows/${shadowPath}`;
    const target = `${GUEST_WORKDIR}/${shadowPath}`;
    lines.push(`sudo mkdir -p ${shellQuote(shadow)}`);
    lines.push(`sudo chown $(id -u):$(id -g) ${shellQuote(shadow)}`);
    lines.push(`mkdir -p ${shellQuote(target)}`);
    lines.push(`sudo mount --bind ${shellQuote(shadow)} ${shellQuote(target)}`);
  }

  return `${lines.join('\n')}\n`;
}

const CLONE_IDENTITY_FINALIZER = `set -eu
mkdir -p /var/lib/psbx
if [ ! -f /var/lib/psbx/identity-finalized ]; then
  if command -v ssh-keygen >/dev/null 2>&1; then
    ssh-keygen -A >/dev/null 2>&1 || true
  fi
  touch /var/lib/psbx/identity-finalized
fi
`;

const CACHE_SYSPREP_VERSION = 3;

const CACHE_SYSPREP_SCRIPT = `set -eu
install_regenerator_script() {
  mkdir -p /usr/local/sbin
  cat >/usr/local/sbin/psbx-regenerate-ssh-host-keys <<'EOF'
#!/bin/sh
set -eu
ssh-keygen -A >/dev/null 2>&1
mkdir -p /var/lib/psbx
touch /var/lib/psbx/ssh-host-keys-ready
EOF
  chmod 755 /usr/local/sbin/psbx-regenerate-ssh-host-keys
}

installed_regenerator=0
if command -v systemctl >/dev/null 2>&1 && command -v ssh-keygen >/dev/null 2>&1 && [ -d /etc/systemd/system ]; then
  install_regenerator_script
  cat >/etc/systemd/system/psbx-regenerate-ssh-host-keys.service <<'EOF'
[Unit]
Description=Regenerate psbx clone SSH host keys
DefaultDependencies=no
Before=ssh.service sshd.service
ConditionPathExists=!/var/lib/psbx/ssh-host-keys-ready

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/psbx-regenerate-ssh-host-keys

[Install]
WantedBy=sysinit.target
EOF
  systemctl enable psbx-regenerate-ssh-host-keys.service >/dev/null 2>&1
  installed_regenerator=1
elif command -v rc-update >/dev/null 2>&1 && command -v ssh-keygen >/dev/null 2>&1 && [ -d /etc/init.d ] && [ -x /sbin/openrc-run ]; then
  install_regenerator_script
  cat >/etc/init.d/psbx-regenerate-ssh-host-keys <<'EOF'
#!/sbin/openrc-run
description="Regenerate psbx clone SSH host keys"

depend() {
  need localmount
  before sshd ssh
}

start() {
  if [ -f /var/lib/psbx/ssh-host-keys-ready ]; then
    return 0
  fi
  ebegin "Regenerating psbx clone SSH host keys"
  /usr/local/sbin/psbx-regenerate-ssh-host-keys
  eend $?
}
EOF
  chmod 755 /etc/init.d/psbx-regenerate-ssh-host-keys
  rc-update add psbx-regenerate-ssh-host-keys boot >/dev/null 2>&1 || rc-update add psbx-regenerate-ssh-host-keys default >/dev/null 2>&1
  installed_regenerator=1
fi
if [ "$installed_regenerator" != "1" ]; then
  echo "psbx: unsupported guest init system for clone SSH host key regeneration" >&2
  exit 1
fi
rm -f /var/lib/psbx/ssh-host-keys-ready /var/lib/psbx/identity-finalized
rm -f /etc/ssh/ssh_host_*
if [ -f /etc/machine-id ]; then
  : > /etc/machine-id
fi
rm -f /var/lib/dbus/machine-id
rm -rf /tmp/* /var/tmp/*
sync
`;

function finalizeVm(vmName: string, profile: Profile): void {
  limaShellScript(vmName, CLONE_IDENTITY_FINALIZER, { asRoot: true });
  limaShellScript(vmName, profileConfigFinalizerScript(profile));
}

function cacheSysprepScript(): string {
  return CACHE_SYSPREP_SCRIPT;
}

function sysprepCacheVm(vmName: string): void {
  limaShellScript(vmName, cacheSysprepScript(), { asRoot: true });
}

export {
  CACHE_SYSPREP_VERSION,
  cacheSysprepScript,
  finalizeVm,
  profileConfigFinalizerScript,
  sysprepCacheVm,
};
