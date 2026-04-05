import { blake2b } from "blakejs";

// Statement Store binary format field tags (from sp_statement_store)
const FIELD_TAG_AUTH = 0; // Authentication / proof
const FIELD_TAG_PLAIN_DATA = 4; // Plain data
const PROOF_TYPE_SR25519 = 1;

/**
 * Build the internal Statement binary with just the plain data field.
 * Format: [num_fields: u32_le] [tag: u8] [payload_len: u32_le] [payload]
 */
function buildDataOnlyStatement(data: Uint8Array): Uint8Array {
  const numFields = 1;
  const totalLen = 4 + 1 + 4 + data.length;
  const buf = new Uint8Array(totalLen);
  const view = new DataView(buf.buffer);

  let offset = 0;
  view.setUint32(offset, numFields, true);
  offset += 4;
  buf[offset] = FIELD_TAG_PLAIN_DATA;
  offset += 1;
  view.setUint32(offset, data.length, true);
  offset += 4;
  buf.set(data, offset);

  return buf;
}

/**
 * Build a signed Statement binary with auth proof + plain data.
 * Proof format: [proof_type: u8] [public_key: 32B] [signature: 64B]
 */
function buildSignedStatement(
  data: Uint8Array,
  publicKey: Uint8Array,
  signature: Uint8Array
): Uint8Array {
  const proof = new Uint8Array(1 + 32 + 64);
  proof[0] = PROOF_TYPE_SR25519;
  proof.set(publicKey, 1);
  proof.set(signature, 33);

  const numFields = 2;
  const totalLen = 4 + (1 + 4 + proof.length) + (1 + 4 + data.length);
  const buf = new Uint8Array(totalLen);
  const view = new DataView(buf.buffer);

  let offset = 0;
  view.setUint32(offset, numFields, true);
  offset += 4;

  // Auth/proof field
  buf[offset] = FIELD_TAG_AUTH;
  offset += 1;
  view.setUint32(offset, proof.length, true);
  offset += 4;
  buf.set(proof, offset);
  offset += proof.length;

  // Plain data field
  buf[offset] = FIELD_TAG_PLAIN_DATA;
  offset += 1;
  view.setUint32(offset, data.length, true);
  offset += 4;
  buf.set(data, offset);

  return buf;
}

/**
 * SCALE-encode a byte array as Vec<u8> (compact length prefix + bytes).
 */
function scaleEncodeVec(data: Uint8Array): Uint8Array {
  const len = data.length;
  let header: Uint8Array;

  if (len < 64) {
    header = new Uint8Array(1);
    header[0] = len << 2;
  } else if (len < 1 << 14) {
    header = new Uint8Array(2);
    const val = (len << 2) | 0x01;
    header[0] = val & 0xff;
    header[1] = (val >> 8) & 0xff;
  } else if (len < 1 << 30) {
    header = new Uint8Array(4);
    const val = (len << 2) | 0x02;
    header[0] = val & 0xff;
    header[1] = (val >> 8) & 0xff;
    header[2] = (val >> 16) & 0xff;
    header[3] = (val >> 24) & 0xff;
  } else {
    throw new Error("Data too large for SCALE compact encoding");
  }

  const result = new Uint8Array(header.length + data.length);
  result.set(header);
  result.set(data, header.length);
  return result;
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
 * Builds a signed Statement (sp_statement_store format), SCALE-encodes it,
 * and calls the `statement_submit` JSON-RPC method via HTTP POST.
 */
export async function submitToStatementStore(
  wsUrl: string,
  fileBytes: Uint8Array,
  publicKey: Uint8Array,
  sign: (message: Uint8Array) => Uint8Array | Promise<Uint8Array>
): Promise<void> {
  // 1. Build unsigned statement binary (data only) and hash it
  const unsignedBinary = buildDataOnlyStatement(fileBytes);
  const hash = blake2b(unsignedBinary, undefined, 32);

  // 2. Sign the hash with sr25519
  const signature = await sign(hash);

  // 3. Build the full signed statement binary
  const signedBinary = buildSignedStatement(fileBytes, publicKey, signature);

  // 4. SCALE-encode as Vec<u8>
  const encoded = scaleEncodeVec(signedBinary);

  // 5. Submit via JSON-RPC
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
      `Statement Store error: ${result.error.message}${result.error.data ? ` (${JSON.stringify(result.error.data)})` : ""}`
    );
  }
}
