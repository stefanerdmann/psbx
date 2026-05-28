#!/bin/bash
set -euo pipefail

mkdir -p "$HOME/.config/opencode"

# --- Install global tools --------------------------------------------------
mkdir -p "$HOME/.npm-global"
npm config set prefix "$HOME/.npm-global"
export PATH="$HOME/.npm-global/bin:$PATH"

npm install -g opencode-ai

# --- Shell config -----------------------------------------------------------
# Add to .bashrc for interactive shells
echo 'export PATH="$HOME/.npm-global/bin:$PATH"' >> "$HOME/.bashrc"
echo 'export NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt' >> "$HOME/.bashrc"
echo 'cd "$HOME/workdir"' >> "$HOME/.bashrc"
