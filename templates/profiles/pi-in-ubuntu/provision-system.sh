#!/bin/bash
set -euo pipefail

while fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1; do sleep 1; done

apt-get update
apt-get install -y ca-certificates curl fd-find git ripgrep xz-utils
ln -sf /usr/bin/fdfind /usr/local/bin/fd

# --- Install Node.js -------------------------------------------------------
NODE_VERSION=$(curl -fsSL https://nodejs.org/dist/latest/SHASUMS256.txt | \
  grep -oE 'node-v[0-9]+\.[0-9]+\.[0-9]+' | head -1 | sed 's/node-//')
case "$(uname -m)" in
  x86_64)  ARCH="x64" ;;
  aarch64) ARCH="arm64" ;;
  armv7l)  ARCH="armv7l" ;;
  *) echo "Unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac
curl -fsSL "https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-linux-${ARCH}.tar.xz" \
  | tar -xJC /usr/local --strip-components=1
