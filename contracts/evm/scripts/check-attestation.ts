/**
 * check-attestation.ts
 *
 * Standalone script to verify a ZK PAN attestation on Paseo.
 * Reads directly from Protocol Commons AttestationRegistry v1.
 *
 * Usage:
 *   # Check signer address
 *   npx hardhat run scripts/check-attestation.ts --network polkadotTestnet
 *
 *   # Check any address
 *   ADDRESS=0x1ce8a0396f534eafa23568669d5d529feb1cac68 \
 *     npx hardhat run scripts/check-attestation.ts --network polkadotTestnet
 */

import hre from "hardhat";
import * as fs from "fs";
import * as path from "path";

// ── Paseo chain definition ────────────────────────────────────────────────────

const paseoAssetHub = {
	id: 420420417,
	name: "Paseo Asset Hub",
	nativeCurrency: { name: "PAS", symbol: "PAS", decimals: 18 },
	rpcUrls: {
		default: { http: ["https://testnet-passet-hub-eth-rpc.polkadot.io"] },
		public: { http: ["https://testnet-passet-hub-eth-rpc.polkadot.io"] },
	},
} as const;

// ── Deployed addresses ────────────────────────────────────────────────────────

const DEPLOYMENTS_JSON = path.resolve(__dirname, "../../../deployments.json");

function loadDeployments() {
	if (!fs.existsSync(DEPLOYMENTS_JSON)) {
		throw new Error("deployments.json not found. Run deploy.ts first.");
	}
	return JSON.parse(fs.readFileSync(DEPLOYMENTS_JSON, "utf-8"));
}

// ── ABIs ──────────────────────────────────────────────────────────────────────

// Protocol Commons AttestationRegistry v1
const REGISTRY_ABI = [
	{
		name: "isValid",
		type: "function",
		stateMutability: "view",
		inputs: [
			{ name: "subject", type: "address" },
			{ name: "schema", type: "bytes32" },
			{ name: "attester", type: "address" },
		],
		outputs: [{ name: "", type: "bool" }],
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
		outputs: [{ name: "", type: "bool" }],
	},
	{
		name: "get",
		type: "function",
		stateMutability: "view",
		inputs: [
			{ name: "subject", type: "address" },
			{ name: "schema", type: "bytes32" },
			{ name: "attester", type: "address" },
		],
		outputs: [
			{
				name: "",
				type: "tuple",
				components: [
					{ name: "schema", type: "bytes32" },
					{ name: "attester", type: "address" },
					{ name: "subject", type: "address" },
					{ name: "value", type: "bytes32" },
					{ name: "expiry", type: "uint64" },
					{ name: "issuedAt", type: "uint64" },
					{ name: "revokedAt", type: "uint64" },
				],
			},
		],
	},
] as const;

// PANAttester
const PAN_ATTESTER_ABI = [
	{
		name: "hasValidAttestation",
		type: "function",
		stateMutability: "view",
		inputs: [{ name: "user", type: "address" }],
		outputs: [{ name: "", type: "bool" }],
	},
	{
		name: "getNullifierByAddress",
		type: "function",
		stateMutability: "view",
		inputs: [{ name: "user", type: "address" }],
		outputs: [{ name: "", type: "uint256" }],
	},
	{
		name: "isNullifierUsed",
		type: "function",
		stateMutability: "view",
		inputs: [{ name: "nullifier", type: "uint256" }],
		outputs: [{ name: "", type: "bool" }],
	},
	{
		name: "SCHEMA",
		type: "function",
		stateMutability: "view",
		inputs: [],
		outputs: [{ name: "", type: "bytes32" }],
	},
	{
		name: "nullifierSeed",
		type: "function",
		stateMutability: "view",
		inputs: [],
		outputs: [{ name: "", type: "uint256" }],
	},
] as const;

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
	const [walletClient] = await hre.viem.getWalletClients({
		chain: paseoAssetHub,
	});
	const publicClient = await hre.viem.getPublicClient({
		chain: paseoAssetHub,
	});

	// Load deployed addresses
	const deployed = loadDeployments();
	const panAttesterAddress = deployed.panAttester as `0x${string}`;
	const registryAddress = deployed.attestationRegistry as `0x${string}`;
	const schema = deployed.schema as `0x${string}`;

	// Address to check
	const subject = (
		process.env.ADDRESS || walletClient.account.address
	) as `0x${string}`;

	console.log("");
	console.log("╔════════════════════════════════════════════════╗");
	console.log("║     ZK PAN — Attestation Verification          ║");
	console.log("╚════════════════════════════════════════════════╝");
	console.log("");
	console.log("  Network:   Paseo Asset Hub (Chain ID: 420420417)");
	console.log("  Subject:  ", subject);
	console.log("  Attester: ", panAttesterAddress);
	console.log("  Registry: ", registryAddress);
	console.log("  Schema:   ", schema);
	console.log("");
	console.log("────────────────────────────────────────────────");

	// ── Step 1: PANAttester.hasValidAttestation ───────────────────────────────
	const hasValid = await publicClient.readContract({
		address: panAttesterAddress,
		abi: PAN_ATTESTER_ABI,
		functionName: "hasValidAttestation",
		args: [subject],
	});

	console.log("");
	console.log("  [1] PANAttester.hasValidAttestation()");
	console.log(
		"      →",
		hasValid ? "✅ true — Valid PAN attestation exists" : "❌ false — No attestation"
	);

	// ── Step 2: AttestationRegistry.isValid ──────────────────────────────────
	const isValid = await publicClient.readContract({
		address: registryAddress,
		abi: REGISTRY_ABI,
		functionName: "isValid",
		args: [subject, schema, panAttesterAddress],
	});

	console.log("");
	console.log("  [2] AttestationRegistry.isValid()");
	console.log(
		"      →",
		isValid ? "✅ true — Registry confirms attestation" : "❌ false — Not found in registry"
	);

	// ── Step 3: Full attestation record ──────────────────────────────────────
	console.log("");
	console.log("  [3] AttestationRegistry.get() — Full record");

	try {
		const record = await publicClient.readContract({
			address: registryAddress,
			abi: REGISTRY_ABI,
			functionName: "get",
			args: [subject, schema, panAttesterAddress],
		});

		const issuedAt = Number(record.issuedAt);
		const revokedAt = Number(record.revokedAt);
		const expiry = Number(record.expiry);

		console.log("      schema:    ", record.schema);
		console.log("      attester:  ", record.attester);
		console.log("      subject:   ", record.subject);
		console.log("      value:     ", record.value, "(nullifier as bytes32)");
		console.log(
			"      issuedAt:  ",
			issuedAt > 0
				? new Date(issuedAt * 1000).toISOString()
				: "not issued"
		);
		console.log(
			"      expiry:    ",
			expiry === 0 ? "never" : new Date(expiry * 1000).toISOString()
		);
		console.log(
			"      revoked:   ",
			revokedAt > 0
				? `Yes — ${new Date(revokedAt * 1000).toISOString()}`
				: "No"
		);
	} catch {
		console.log("      → No record found");
	}

	// ── Step 4: Nullifier check ───────────────────────────────────────────────
	console.log("");
	console.log("  [4] PANAttester.getNullifierByAddress()");
	const nullifier = await publicClient.readContract({
		address: panAttesterAddress,
		abi: PAN_ATTESTER_ABI,
		functionName: "getNullifierByAddress",
		args: [subject],
	});
	if (nullifier === 0n) {
		console.log("      → No nullifier found for this address");
	} else {
		console.log(
			"      →",
			nullifier.toString().slice(0, 20) + "...",
			"(truncated)"
		);
	}

	// ── Summary ───────────────────────────────────────────────────────────────
	console.log("");
	console.log("────────────────────────────────────────────────");
	console.log("");

	if (hasValid && isValid) {
		console.log("  ✅ RESULT: VERIFIED INDIAN PAN HOLDER");
		console.log("");
		console.log("  This address has proven ownership of a valid,");
		console.log("  government-signed Indian PAN card without");
		console.log("  revealing any personal information.");
		console.log("");
		console.log("  Proof type:  Groth16 ZK (Circom)");
		console.log("  Signed by:   National e-Governance Division");
		console.log("  On-chain:    Paseo Asset Hub");
		console.log("  Sybil-safe:  Yes (nullifier prevents reuse)");
	} else {
		console.log("  ❌ RESULT: NO VALID PAN ATTESTATION FOUND");
		console.log("");
		console.log("  This address has not submitted a ZK PAN proof.");
		console.log("  Generate a proof at: http://localhost:3000/generate");
	}

	console.log("");
	console.log("╚════════════════════════════════════════════════╝");
	console.log("");
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
