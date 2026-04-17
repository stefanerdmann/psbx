#!/bin/bash
export DYNAMIC_PROJECT_DIR=$(pwd)

# 1. Get the raw path from Python
RAW_CERT_PATH=$(python3 -m certifi)

if [ ! -f "$RAW_CERT_PATH" ]; then
    echo "❌ Error: Could not locate certifi bundle on the host."
    exit 1
fi

# 2. Resolve any symlinks to find the true, absolute file path
REAL_CERT_PATH=$(realpath "$RAW_CERT_PATH")
echo "🔐 Resolved true host certificate path to: $REAL_CERT_PATH"

# 3. Split into Directory (for mounting) and File (for copying)
export HOST_CERT_DIR=$(dirname "$REAL_CERT_PATH")
export HOST_CERT_FILE=$(basename "$REAL_CERT_PATH")

PROJECT_NAME=$(basename "$DYNAMIC_PROJECT_DIR")
TEMPLATE_PATH="$HOME/.pi/pi-lima-template.yaml"

# Replace the variables in the template
envsubst '${DYNAMIC_PROJECT_DIR} ${HOST_CERT_DIR} ${HOST_CERT_FILE}' < "$TEMPLATE_PATH" > "/tmp/lima-${PROJECT_NAME}.yaml"

echo "🚀 Starting environment: $PROJECT_NAME (Waiting for VM networking...)"

echo "Creating VM..."
limactl start --tty=false --name "$PROJECT_NAME" "/tmp/lima-${PROJECT_NAME}.yaml"

echo ""
echo "✅ VM is ready! Type 'limactl shell $PROJECT_NAME' to enter."