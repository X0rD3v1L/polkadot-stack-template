#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "=== Polkadot Stack Template - Local Zombienet ==="
echo ""
echo "  Spawning relay chain + parachain via zombienet..."
echo ""

cd "$ROOT_DIR/blockchain"
zombienet -p native spawn zombienet.toml
