#!/bin/bash
set -euo pipefail

while fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1; do sleep 1; done

apt-get update
apt-get install -y ca-certificates curl fd-find git ripgrep xz-utils
ln -sf /usr/bin/fdfind /usr/local/bin/fd

# --- Install Node.js -------------------------------------------------------
# Fetch the checksum manifest once and reuse it for two purposes: parsing the
# latest version string AND verifying the downloaded tarball before extraction.
# Verifying the tarball against the already-fetched, HTTPS-delivered manifest
# closes a supply-chain hole (a compromised mirror could otherwise inject a
# root-level binary into every sandbox).
NODE_SHASUMS=$(curl -fsSL https://nodejs.org/dist/latest/SHASUMS256.txt)
NODE_VERSION=$(printf '%s\n' "$NODE_SHASUMS" | \
  grep -oE 'node-v[0-9]+\.[0-9]+\.[0-9]+' | head -1 | sed 's/node-//')
case "$(uname -m)" in
  x86_64)  ARCH="x64" ;;
  aarch64) ARCH="arm64" ;;
  armv7l)  ARCH="armv7l" ;;
  *) echo "Unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac
NODE_TARBALL="node-${NODE_VERSION}-linux-${ARCH}.tar.xz"
NODE_TMP=$(mktemp -d)
trap 'rm -rf "$NODE_TMP"' EXIT
curl -fsSL "https://nodejs.org/dist/${NODE_VERSION}/${NODE_TARBALL}" -o "${NODE_TMP}/${NODE_TARBALL}"

# Abort unless the tarball matches its published sha256 checksum.
NODE_SUM=$(printf '%s\n' "$NODE_SHASUMS" | grep " ${NODE_TARBALL}\$")
if [ -z "$NODE_SUM" ]; then
  echo "No checksum found for ${NODE_TARBALL} in SHASUMS256.txt" >&2
  exit 1
fi
( cd "$NODE_TMP" && printf '%s\n' "$NODE_SUM" | sha256sum -c - )

tar -xJ --strip-components=1 -C /usr/local -f "${NODE_TMP}/${NODE_TARBALL}"
