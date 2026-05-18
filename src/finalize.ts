/**
 * VM finalization scripts.
 *
 * Two distinct shell payloads live here:
 *
 *   1. `CLONE_IDENTITY_FINALIZER` + `profileConfigFinalizerScript()` — run
 *      on every project VM after clone/create. Materializes profile config
 *      mounts into the guest home, applies per-mount fix-ups (e.g. tighten
 *      `auth.json` perms, point pi's `sessionDir` at the project's `.agents`
 *      dir, symlink the copilot session-state into the project), and on a
 *      cloned VM regenerates SSH host keys once.
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
import { shellQuote } from './utils.ts';

function guestProjectPath(relativePath: string): string {
  return `${GUEST_WORKDIR}/${relativePath.replace(/^\.?\//, '')}`;
}

function profileConfigFinalizerScript(profile: Profile): string {
  const lines: string[] = [
    'set -eu',
    `until mountpoint -q ${shellQuote(GUEST_WORKDIR)}; do sleep 1; done`,
  ];

  for (const mount of profile.configMounts || []) {
    if (mount.projectSessionDir) {
      lines.push(`mkdir -p ${shellQuote(guestProjectPath(mount.projectSessionDir))}`);
    }
  }

  for (const mount of profile.configMounts || []) {
    const source = mountPointFor(mount);
    const target = expandGuestHome(mount.guestTarget);
    lines.push(`mkdir -p ${shellQuote(target)}`);
    lines.push(
      `if [ -d ${shellQuote(`${source}/.`)} ]; then cp -a ${shellQuote(`${source}/.`)} ${shellQuote(target)}; fi`,
    );

    if (target === '/home/pi/.pi/agent') {
      const sessionDir = mount.projectSessionDir
        ? guestProjectPath(mount.projectSessionDir)
        : `${GUEST_WORKDIR}/.agents/sessions`;
      lines.push(
        `if [ -f ${shellQuote(`${target}/auth.json`)} ]; then chmod 600 ${shellQuote(`${target}/auth.json`)}; fi`,
      );
      lines.push(`if command -v node >/dev/null 2>&1; then
  node -e ${shellQuote(`
    const fs = require('fs');
    const path = '${target}/settings.json';
    let settings = {};
    try { settings = JSON.parse(fs.readFileSync(path, 'utf-8')); } catch {}
    settings.sessionDir = '${sessionDir}';
    fs.writeFileSync(path, JSON.stringify(settings, null, 2) + '\\n');
  `)}
fi`);
    }

    if (target === '/home/pi/.copilot' && mount.projectSessionDir) {
      const sessionTarget = guestProjectPath(mount.projectSessionDir);
      lines.push(`rm -rf ${shellQuote(`${target}/session-state`)}`);
      lines.push(`ln -sfn ${shellQuote(sessionTarget)} ${shellQuote(`${target}/session-state`)}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

const CLONE_IDENTITY_FINALIZER = `set -eu
mkdir -p /var/lib/pi-sandbox
if [ ! -f /var/lib/pi-sandbox/identity-finalized ]; then
  if command -v ssh-keygen >/dev/null 2>&1; then
    ssh-keygen -A >/dev/null 2>&1 || true
  fi
  touch /var/lib/pi-sandbox/identity-finalized
fi
`;

const CACHE_SYSPREP_VERSION = 3;

const CACHE_SYSPREP_SCRIPT = `set -eu
install_regenerator_script() {
  mkdir -p /usr/local/sbin
  cat >/usr/local/sbin/pi-sandbox-regenerate-ssh-host-keys <<'EOF'
#!/bin/sh
set -eu
ssh-keygen -A >/dev/null 2>&1
mkdir -p /var/lib/pi-sandbox
touch /var/lib/pi-sandbox/ssh-host-keys-ready
EOF
  chmod 755 /usr/local/sbin/pi-sandbox-regenerate-ssh-host-keys
}

installed_regenerator=0
if command -v systemctl >/dev/null 2>&1 && command -v ssh-keygen >/dev/null 2>&1 && [ -d /etc/systemd/system ]; then
  install_regenerator_script
  cat >/etc/systemd/system/pi-sandbox-regenerate-ssh-host-keys.service <<'EOF'
[Unit]
Description=Regenerate pi-sandbox clone SSH host keys
DefaultDependencies=no
Before=ssh.service sshd.service
ConditionPathExists=!/var/lib/pi-sandbox/ssh-host-keys-ready

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/pi-sandbox-regenerate-ssh-host-keys

[Install]
WantedBy=sysinit.target
EOF
  systemctl enable pi-sandbox-regenerate-ssh-host-keys.service >/dev/null 2>&1
  installed_regenerator=1
elif command -v rc-update >/dev/null 2>&1 && command -v ssh-keygen >/dev/null 2>&1 && [ -d /etc/init.d ] && [ -x /sbin/openrc-run ]; then
  install_regenerator_script
  cat >/etc/init.d/pi-sandbox-regenerate-ssh-host-keys <<'EOF'
#!/sbin/openrc-run
description="Regenerate pi-sandbox clone SSH host keys"

depend() {
  need localmount
  before sshd ssh
}

start() {
  if [ -f /var/lib/pi-sandbox/ssh-host-keys-ready ]; then
    return 0
  fi
  ebegin "Regenerating pi-sandbox clone SSH host keys"
  /usr/local/sbin/pi-sandbox-regenerate-ssh-host-keys
  eend $?
}
EOF
  chmod 755 /etc/init.d/pi-sandbox-regenerate-ssh-host-keys
  rc-update add pi-sandbox-regenerate-ssh-host-keys boot >/dev/null 2>&1 || rc-update add pi-sandbox-regenerate-ssh-host-keys default >/dev/null 2>&1
  installed_regenerator=1
fi
if [ "$installed_regenerator" != "1" ]; then
  echo "pi-sandbox: unsupported guest init system for clone SSH host key regeneration" >&2
  exit 1
fi
rm -f /var/lib/pi-sandbox/ssh-host-keys-ready /var/lib/pi-sandbox/identity-finalized
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
