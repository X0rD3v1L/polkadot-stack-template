#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

echo "=== Polkadot Stack Template - Local Development ==="
echo ""

# Build the runtime
echo "[1/3] Building runtime..."
build_runtime

# Create the chain spec using the newly built WASM
echo "[2/3] Generating chain spec..."
generate_chain_spec

echo "  Chain spec written to blockchain/chain_spec.json"

# Start the local network
echo "[3/3] Starting local relay chain + collator..."
echo "  RPC endpoint: ws://127.0.0.1:9944"
echo ""
echo "  For Ethereum RPC + contract deployment, use start-dev-with-contracts.sh instead."
echo ""
run_zombienet_foreground
