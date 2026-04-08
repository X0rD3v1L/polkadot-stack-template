#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
source "$SCRIPT_DIR/common.sh"

echo "=== Polkadot Stack Template - Local Zombienet ==="
echo ""
echo "  Spawning relay chain + parachain via zombienet..."
echo ""

run_zombienet_foreground
