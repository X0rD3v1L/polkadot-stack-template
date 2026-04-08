import { Bytes, compact, u8 } from "@polkadot-api/substrate-bindings";

const MAX_STATEMENT_STORE_ENCODED_SIZE = 1024 * 1024 - 1;
const FIELD_TAG_AUTH = 0;
const FIELD_TAG_PLAIN_DATA = 8;
const PROOF_VARIANT_SR25519 = 0;

const encodeVecU8 = Bytes.enc();

function concatBytes(parts: Uint8Array[]): Uint8Array {
	const totalLen = parts.reduce((sum, part) => sum + part.length, 0);
	const result = new Uint8Array(totalLen);
	let offset = 0;

	for (const part of parts) {
		result.set(part, offset);
		offset += part.length;
	}

	return result;
}

function ensureFixedLength(value: Uint8Array, length: number, label: string): void {
	if (value.length !== length) {
		throw new Error(`${label} must be ${length} bytes, got ${value.length}`);
	}
}

function encodeSr25519Proof(publicKey: Uint8Array, signature: Uint8Array): Uint8Array {
	ensureFixedLength(publicKey, 32, "Statement Store public key");
	ensureFixedLength(signature, 64, "Statement Store signature");

	return concatBytes([u8.enc(PROOF_VARIANT_SR25519), signature, publicKey]);
}

function encodeDataField(data: Uint8Array): Uint8Array {
	return concatBytes([u8.enc(FIELD_TAG_PLAIN_DATA), encodeVecU8(data)]);
}

function encodeProofField(publicKey: Uint8Array, signature: Uint8Array): Uint8Array {
	return concatBytes([u8.enc(FIELD_TAG_AUTH), encodeSr25519Proof(publicKey, signature)]);
}

function buildStatementSignaturePayload(data: Uint8Array): Uint8Array {
	// Matches sp_statement_store::Statement::encoded(true) for a data-only statement.
	return encodeDataField(data);
}

function buildSignedStatement(
	data: Uint8Array,
	publicKey: Uint8Array,
	signature: Uint8Array,
): Uint8Array {
	return concatBytes([
		compact.enc(2),
		encodeProofField(publicKey, signature),
		encodeDataField(data),
	]);
}

function bytesToHex(bytes: Uint8Array): string {
	return Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

/**
 * Convert a ws:// or wss:// URL to http:// or https:// for JSON-RPC POST.
 */
function wsToHttp(wsUrl: string): string {
	return wsUrl.replace(/^ws(s?):\/\//, "http$1://");
}

/**
 * Submit file bytes to the local node's Statement Store.
 *
 * Builds a canonical SCALE-encoded sp_statement_store::Statement and
 * calls the `statement_submit` JSON-RPC method via HTTP POST.
 */
export async function submitToStatementStore(
	wsUrl: string,
	fileBytes: Uint8Array,
	publicKey: Uint8Array,
	sign: (message: Uint8Array) => Uint8Array | Promise<Uint8Array>,
): Promise<void> {
	const signaturePayload = buildStatementSignaturePayload(fileBytes);
	const signature = await sign(signaturePayload);
	const encoded = buildSignedStatement(fileBytes, publicKey, signature);

	if (encoded.length > MAX_STATEMENT_STORE_ENCODED_SIZE) {
		throw new Error(
			`Statement is too large for node propagation (${encoded.length} encoded bytes, max ${MAX_STATEMENT_STORE_ENCODED_SIZE}). Choose a smaller file.`,
		);
	}

	const httpUrl = wsToHttp(wsUrl);
	const response = await fetch(httpUrl, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			jsonrpc: "2.0",
			id: 1,
			method: "statement_submit",
			params: [`0x${bytesToHex(encoded)}`],
		}),
	});

	const result = await response.json();
	if (result.error) {
		throw new Error(
			`Statement Store error: ${result.error.message}${result.error.data ? ` (${JSON.stringify(result.error.data)})` : ""}`,
		);
	}
}
