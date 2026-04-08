#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
source "$SCRIPT_DIR/common.sh"

NODE_PID=""
ETH_RPC_PID=""

cleanup() {
    echo ""
    echo "Shutting down..."
    if [ -n "$ETH_RPC_PID" ]; then
        kill "$ETH_RPC_PID" 2>/dev/null || true
        wait "$ETH_RPC_PID" 2>/dev/null || true
    fi
    cleanup_local_node
}
trap cleanup EXIT INT TERM

echo "=== Polkadot Stack Template - Local Dev with Contracts ==="
echo ""
echo "  This is the lightweight solo-node path for contract/frontend iteration."
echo "  Statement Store is not available here on stable2512-3."
echo "  Use start-all.sh (or start-zombienet-all.sh) for the full relay-backed stack."
echo ""

# Build the runtime
echo "[1/5] Building runtime..."
build_runtime

# Create the chain spec
echo "[2/5] Generating chain spec..."
generate_chain_spec

# Install and compile contracts
echo "[3/5] Compiling contracts..."
cd "$ROOT_DIR/contracts/evm" && npm install --silent && npx hardhat compile
cd "$ROOT_DIR/contracts/pvm" && npm install --silent && npx hardhat compile
cd "$ROOT_DIR"

# Start the local node in background
echo "[4/5] Starting local omni-node..."
start_local_node_background
wait_for_substrate_rpc

# Start eth-rpc adapter
start_eth_rpc_background
wait_for_eth_rpc

# Deploy contracts
echo "[5/5] Deploying contracts..."
echo "  Deploying ProofOfExistence via EVM (solc)..."
cd "$ROOT_DIR/contracts/evm"
npm run deploy:local

echo "  Deploying ProofOfExistence via PVM (resolc)..."
cd "$ROOT_DIR/contracts/pvm"
npm run deploy:local

cd "$ROOT_DIR"

echo ""
echo "=== Dev environment running ==="
echo "  Substrate RPC: ws://127.0.0.1:9944"
echo "  Ethereum RPC:  http://127.0.0.1:8545"
echo "  Statement Store: unavailable in this solo-node mode"
echo ""
echo "  Frontend: cd web && npm install && npm run dev"
echo ""
echo "Press Ctrl+C to stop."
wait "$NODE_PID"
