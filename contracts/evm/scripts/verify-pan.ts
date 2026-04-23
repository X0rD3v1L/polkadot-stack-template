/**
 * verify-pan.ts
 *
 * Checks if a wallet address has a valid ZK PAN attestation on Paseo.
 * Uses Protocol Commons AttestationRegistry v1.
 *
 * Usage:
 *   npx hardhat run scripts/verify-pan.ts --network polkadotTestnet
 *   ADDRESS=0x... npx hardhat run scripts/verify-pan.ts --network polkadotTestnet
 *   PROOF_FILE=~/Downloads/zk-pan-proof-testnet.json npx hardhat run scripts/verify-pan.ts --network polkadotTestnet
 */

import hre from "hardhat";
import * as fs from "fs";
import * as path from "path";

const DEPLOYMENTS_JSON = path.resolve(__dirname, "../../../deployments.json");

const paseoAssetHub = {
	id: 420420417,
	name: "Paseo Asset Hub",
	nativeCurrency: { name: "PAS", symbol: "PAS", decimals: 18 },
	rpcUrls: {
		default: { http: ["https://testnet-passet-hub-eth-rpc.polkadot.io"] },
		public: { http: ["https://testnet-passet-hub-eth-rpc.polkadot.io"] },
	},
} as const;

// ── ABIs ──────────────────────────────────────────────────────────────────────

const PAN_ATTESTER_ABI = [
	{
		name: "verifyAndAttest",
		type: "function",
		stateMutability: "nonpayable",
		inputs: [
			{ name: "nullifier", type: "uint256" },
			{ name: "documentType", type: "uint256" },
			{ name: "reveal", type: "uint256" },
			{ name: "signal", type: "uint256" },
			{ name: "groth16Proof", type: "uint256[8]" },
		],
		outputs: [],
	},
	{
		name: "hasValidAttestation",
		type: "function",
		stateMutability: "view",
		inputs: [{ name: "user", type: "address" }],
		outputs: [{ type: "bool" }],
	},
	{
		name: "isNullifierUsed",
		type: "function",
		stateMutability: "view",
		inputs: [{ name: "nullifier", type: "uint256" }],
		outputs: [{ type: "bool" }],
	},
	{
		name: "getNullifierByAddress",
		type: "function",
		stateMutability: "view",
		inputs: [{ name: "user", type: "address" }],
		outputs: [{ type: "uint256" }],
	},
	{
		name: "SCHEMA",
		type: "function",
		stateMutability: "view",
		inputs: [],
		outputs: [{ type: "bytes32" }],
	},
	{
		name: "nullifierSeed",
		type: "function",
		stateMutability: "view",
		inputs: [],
		outputs: [{ type: "uint256" }],
	},
	{
		name: "PANVerified",
		type: "event",
		inputs: [
			{ name: "recipient", type: "address", indexed: true },
			{ name: "nullifier", type: "uint256", indexed: true },
			{ name: "timestamp", type: "uint256", indexed: false },
		],
	},
] as const;

// v1 AttestationRegistry ABI
const ATTESTATION_REGISTRY_ABI = [
	{
		name: "isValid",
		type: "function",
		stateMutability: "view",
		inputs: [
			{ name: "subject", type: "address" },
			{ name: "schema", type: "bytes32" },
			{ name: "attester", type: "address" },
		],
		outputs: [{ type: "bool" }],
	},
	{
		name: "isValidAny",
		type: "function",
		stateMutability: "view",
		inputs: [
			{ name: "subject", type: "address" },
			{ name: "schema", type: "bytes32" },
			{ name: "attesters", type: "address[]" },
		],
		outputs: [{ type: "bool" }],
	},
] as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

function loadDeployments(): Record<string, string | null> {
	if (!fs.existsSync(DEPLOYMENTS_JSON)) {
		throw new Error(
			"deployments.json not found. Run the deploy script first."
		);
	}
	return JSON.parse(fs.readFileSync(DEPLOYMENTS_JSON, "utf-8"));
}

function packGroth16Proof(proof: {
	pi_a: string[];
	pi_b: string[][];
	pi_c: string[];
}): readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint] {
	return [
		BigInt(proof.pi_a[0]),
		BigInt(proof.pi_a[1]),
		BigInt(proof.pi_b[0][1]),
		BigInt(proof.pi_b[0][0]),
		BigInt(proof.pi_b[1][1]),
		BigInt(proof.pi_b[1][0]),
		BigInt(proof.pi_c[0]),
		BigInt(proof.pi_c[1]),
	];
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
	const [walletClient] = await hre.viem.getWalletClients({
		chain: paseoAssetHub,
	});
	const publicClient = await hre.viem.getPublicClient({
		chain: paseoAssetHub,
	});

	console.log("════════════════════════════════════════════════");
	console.log("  ZK PAN Verifier — Check Attestation (v1)");
	console.log("════════════════════════════════════════════════");
	console.log("Signer:", walletClient.account.address);
	console.log("");

	// Load addresses from deployments.json
	const deployed = loadDeployments();
	const panAttesterAddress = deployed.panAttester as `0x${string}`;
	const registryAddress = deployed.attestationRegistry as `0x${string}`;
	const schema = deployed.schema as `0x${string}`;

	if (!panAttesterAddress || !registryAddress) {
		throw new Error(
			"panAttester or attestationRegistry missing from deployments.json"
		);
	}

	console.log("PANAttester:         ", panAttesterAddress);
	console.log("AttestationRegistry: ", registryAddress);
	console.log("Schema:              ", schema);
	console.log("");

	const addressToCheck = (
		process.env.ADDRESS || walletClient.account.address
	) as `0x${string}`;
	console.log("Checking address:", addressToCheck);
	console.log("");

	// ── Check 1: hasValidAttestation via PANAttester ──────────────────────────
	console.log("[1] PANAttester.hasValidAttestation()...");
	const hasAttestation = await publicClient.readContract({
		address: panAttesterAddress,
		abi: PAN_ATTESTER_ABI,
		functionName: "hasValidAttestation",
		args: [addressToCheck],
	});
	console.log(
		"    Result:",
		hasAttestation
			? "✅ HAS VALID PAN ATTESTATION"
			: "❌ No attestation found"
	);

	// ── Check 2: isValid via AttestationRegistry v1 directly ─────────────────
	console.log("\n[2] AttestationRegistry.isValid() — v1 direct check...");
	const isValid = await publicClient.readContract({
		address: registryAddress,
		abi: ATTESTATION_REGISTRY_ABI,
		functionName: "isValid",
		args: [addressToCheck, schema, panAttesterAddress],
	});
	console.log(
		"    Result:",
		isValid ? "✅ VALID (registry confirms)" : "❌ Not valid in registry"
	);

	// ── Check 3: Get nullifier for address ────────────────────────────────────
	console.log("\n[3] Getting nullifier for address...");
	const nullifier = await publicClient.readContract({
		address: panAttesterAddress,
		abi: PAN_ATTESTER_ABI,
		functionName: "getNullifierByAddress",
		args: [addressToCheck],
	});

	if (nullifier === 0n) {
		console.log("    No nullifier found — address not yet attested");
	} else {
		console.log(
			"    Nullifier:",
			nullifier.toString().slice(0, 20) + "..."
		);
		console.log("    ✅ Address has been attested");
	}

	// ── Optional: Submit proof ────────────────────────────────────────────────
	if (process.env.PROOF_FILE) {
		console.log("\n════════════════════════════════════════════════");
		console.log("  Submitting proof from:", process.env.PROOF_FILE);
		console.log("════════════════════════════════════════════════");

		const proofFile = JSON.parse(
			fs.readFileSync(process.env.PROOF_FILE, "utf-8")
		);
		const proof = proofFile.proof || proofFile;
		const publicSignals: string[] = proofFile.publicSignals;

		if (!publicSignals) {
			throw new Error("Proof file must contain publicSignals array");
		}

		const groth16Proof = packGroth16Proof(proof);
		const proofNullifier = BigInt(publicSignals[1]);
		const documentType = BigInt(publicSignals[2]);
		const reveal = BigInt(publicSignals[3]);
		const signal = 1n;

		console.log(
			"Nullifier:    ",
			proofNullifier.toString().slice(0, 20) + "..."
		);
		console.log("DocumentType:", documentType.toString());
		console.log("Reveal:       ", reveal.toString());

		// Check if nullifier already used
		const nullifierUsed = await publicClient.readContract({
			address: panAttesterAddress,
			abi: PAN_ATTESTER_ABI,
			functionName: "isNullifierUsed",
			args: [proofNullifier],
		});

		if (nullifierUsed) {
			console.log(
				"\n⚠️  Nullifier already used — this PAN was already attested"
			);
			return;
		}

		console.log("\nSubmitting proof...");
		const hash = await walletClient.writeContract({
			address: panAttesterAddress,
			abi: PAN_ATTESTER_ABI,
			functionName: "verifyAndAttest",
			args: [proofNullifier, documentType, reveal, signal, groth16Proof],
			chain: paseoAssetHub,
		});

		console.log("TX sent:", hash);
		console.log("Waiting for confirmation...");

		const receipt = await publicClient.waitForTransactionReceipt({
			hash,
			timeout: 120_000,
		});

		console.log("✅ Confirmed in block:", receipt.blockNumber);

		// Verify it's now valid
		const isNowValid = await publicClient.readContract({
			address: panAttesterAddress,
			abi: PAN_ATTESTER_ABI,
			functionName: "hasValidAttestation",
			args: [walletClient.account.address],
		});

		console.log(
			"\nPost-submission check:",
			isNowValid ? "✅ Attestation active" : "❌ Still not found"
		);

		if (isNowValid) {
			console.log("\n🎉 PAN Attestation Successfully Issued on Paseo!");
			console.log("   Recipient:       ", walletClient.account.address);
			console.log("   Schema:          ", schema);
			console.log("   Attester:        ", panAttesterAddress);
			console.log("   Registry:        ", registryAddress);
			console.log(
				"\n   Anyone can verify this attestation by calling:"
			);
			console.log(
				`   AttestationRegistry.isValid(${walletClient.account.address}, ${schema}, ${panAttesterAddress})`
			);
		}
	}

	console.log("\n════════════════════════════════════════════════");
	console.log("Done.");
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});