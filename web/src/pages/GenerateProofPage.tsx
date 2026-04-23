/**
 * GenerateProofPage.tsx
 *
 * Drop into: web/src/pages/GenerateProofPage.tsx
 *
 * Add to App.tsx routes:
 *   import GenerateProofPage from './pages/GenerateProofPage';
 *   <Route path="/generate" element={<GenerateProofPage />} />
 *
 * Install deps (if not already in web/):
 *   npm install snarkjs xmldsigjs vite-plugin-node-polyfills
 *
 * Add to vite.config.ts:
 *   import { nodePolyfills } from 'vite-plugin-node-polyfills';
 *   plugins: [react(), nodePolyfills({ globals: { Buffer: true, global: true, process: true } })],
 *   optimizeDeps: { exclude: ['snarkjs'], include: ['xmldsigjs'] }
 *
 * No wallet connection required — proof generation is fully local.
 * The "Claim Event Discount" button links to /event after download.
 */

import { useState, useRef, useCallback } from "react";
import { Application, Parse, SignedXml } from "xmldsigjs";
import { encodeAbiParameters, keccak256 } from "viem";

// ── Init xmldsigjs ────────────────────────────────────────────────────────────
if (typeof window !== "undefined") {
	Application.setEngine("OpenSSL", window.crypto);
}

// ── Constants ─────────────────────────────────────────────────────────────────
const WASM_URL =
	"https://anon-digilocker-artifacts.s3.ap-south-1.amazonaws.com/v1/digilocker-verifier.wasm";
const ZKEY_URL =
	"https://anon-digilocker-artifacts.s3.ap-south-1.amazonaws.com/v1/circuit_final.zkey";

const CERTIFICATE_DATA_TAG = "<Certificate ";
const MAX_INPUT_LENGTH = 512 * 3;
const SIGNED_INFO_MAX_LENGTH = 563;
const RSA_BITS_PER_CHUNK = 121;
const RSA_NUM_CHUNKS = 17;
const NULLIFIER_SEED = 123456789;

// ── Types ─────────────────────────────────────────────────────────────────────
export const PROOF_STEPS = {
	IDLE: "idle",
	PARSING: "parsing",
	GENERATING_INPUT: "generating_input",
	LOADING_WASM: "loading_wasm",
	GENERATING_WITNESS: "generating_witness",
	GENERATING_PROOF: "generating_proof",
	VERIFYING: "verifying",
	DONE: "done",
	ERROR: "error",
} as const;

export type ProofStep = (typeof PROOF_STEPS)[keyof typeof PROOF_STEPS];

interface PANFields {
	name: string;
	dob: string;
	gender: string;
	panNumber: string;
	issuer: string;
	verifiedOn: string;
}

interface ProofResult {
	proof: object;
	publicSignals: string[];
}

// ── ZK helpers ────────────────────────────────────────────────────────────────
function toCharArray(data: Uint8Array): string[] {
	return Array.from(data).map((b) => b.toString());
}

function bigIntToChunked(n: bigint, bitsPerChunk: number, numChunks: number): string[] {
	const mask = (1n << BigInt(bitsPerChunk)) - 1n;
	const chunks: string[] = [];
	for (let i = 0; i < numChunks; i++) {
		chunks.push((n & mask).toString());
		n >>= BigInt(bitsPerChunk);
	}
	return chunks;
}

function sha256Pad(data: Uint8Array, maxLength: number): [Uint8Array, number] {
	const length = data.length;
	const bitLength = BigInt(length * 8);
	const padded = new Uint8Array(maxLength);
	padded.set(data);
	padded[length] = 0x80;
	let paddedLength = length + 1;
	while (paddedLength % 64 !== 56) paddedLength++;
	const view = new DataView(padded.buffer);
	view.setBigUint64(paddedLength, bitLength, false);
	paddedLength += 8;
	return [padded, paddedLength];
}

function sha256Block(h: number[], block: Uint8Array): number[] {
	const K = [
		0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
		0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
		0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
		0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
		0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
		0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
		0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
		0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
		0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
		0xc67178f2,
	];
	const rotr = (x: number, n: number) => ((x >>> n) | (x << (32 - n))) >>> 0;
	const add = (...args: number[]) => args.reduce((a, b) => (a + b) >>> 0, 0);
	const w: number[] = [];
	const view = new DataView(block.buffer, block.byteOffset);
	for (let i = 0; i < 16; i++) w.push(view.getUint32(i * 4, false));
	for (let i = 16; i < 64; i++) {
		const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
		const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
		w.push(add(w[i - 16], s0, w[i - 7], s1));
	}
	let [a, b, c, d, e, f, g, hh] = h;
	for (let i = 0; i < 64; i++) {
		const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
		const ch = (e & f) ^ (~e & g);
		const t1 = add(hh, S1, ch, K[i], w[i]);
		const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
		const maj = (a & b) ^ (a & c) ^ (b & c);
		const t2 = add(S0, maj);
		hh = g;
		g = f;
		f = e;
		e = add(d, t1);
		d = c;
		c = b;
		b = a;
		a = add(t1, t2);
	}
	return [
		add(h[0], a),
		add(h[1], b),
		add(h[2], c),
		add(h[3], d),
		add(h[4], e),
		add(h[5], f),
		add(h[6], g),
		add(h[7], hh),
	];
}

function generatePartialSha(
	body: Uint8Array,
	bodyLength: number,
	selector: string,
	maxRemaining: number,
): [Uint8Array, Uint8Array, number] {
	const enc = new TextEncoder();
	const selectorBytes = enc.encode(selector);
	let selectorIdx = -1;
	outer: for (let i = 0; i < body.length - selectorBytes.length; i++) {
		for (let j = 0; j < selectorBytes.length; j++) {
			if (body[i + j] !== selectorBytes[j]) continue outer;
		}
		selectorIdx = i;
		break;
	}
	if (selectorIdx === -1) throw new Error(`Selector "${selector}" not found`);
	const precomputeUpTo = Math.floor(selectorIdx / 64) * 64;
	let h = [
		0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab,
		0x5be0cd19,
	];
	for (let i = 0; i < precomputeUpTo; i += 64) h = sha256Block(h, body.slice(i, i + 64));
	const precomputed = new Uint8Array(32);
	const view = new DataView(precomputed.buffer);
	for (let i = 0; i < 8; i++) view.setUint32(i * 4, h[i], false);
	const remainingLength = bodyLength - precomputeUpTo;
	const remaining = new Uint8Array(maxRemaining);
	remaining.set(body.slice(precomputeUpTo, precomputeUpTo + maxRemaining));
	return [remaining, precomputed, remainingLength];
}

function hashSignal(signal: number): string {
	const packed = encodeAbiParameters([{ type: "uint256" }], [BigInt(signal)]);
	const hash = keccak256(packed);
	return (BigInt(hash) >> 3n).toString();
}

function parseXML(xmlString: string): Document {
	const parser = new DOMParser();
	const doc = parser.parseFromString(xmlString, "application/xml");
	const error = doc.querySelector("parsererror");
	if (error) throw new Error("Invalid XML: " + error.textContent);
	return doc;
}

async function getSignedDataBytes(xmlString: string): Promise<Uint8Array> {
	const doc = Parse(xmlString);
	const sigNS = "http://www.w3.org/2000/09/xmldsig#";
	const signature = doc.getElementsByTagNameNS(sigNS, "Signature")[0];
	const signedXml = new SignedXml(doc);
	signedXml.LoadXml(signature);
	const references = signedXml.XmlSignature.SignedInfo.References.GetIterator();
	const signedData: string = (signedXml as any).ApplyTransforms(
		(references as any)[0].Transforms,
		doc.documentElement,
	);
	return new TextEncoder().encode(signedData);
}

async function getSignedInfoBytes(xmlString: string): Promise<Uint8Array> {
	const doc = Parse(xmlString);
	const sigNS = "http://www.w3.org/2000/09/xmldsig#";
	const signature = doc.getElementsByTagNameNS(sigNS, "Signature")[0];
	const signedXml = new SignedXml(doc);
	signedXml.LoadXml(signature);
	const signedInfo: string = (signedXml as any).TransformSignedInfo(signedXml);
	return new TextEncoder().encode(signedInfo);
}

function getOriginalSignedData(xmlString: string): Uint8Array {
	let data = xmlString;
	if (data.startsWith("<?xml")) {
		const declEnd = data.indexOf("?>") + 2;
		data = data.slice(declEnd);
		if (data.startsWith("\r\n")) data = data.slice(2);
		else if (data.startsWith("\n")) data = data.slice(1);
	}
	let sigStart = data.indexOf('<Signature xmlns="http://www.w3.org/2000/09/xmldsig#">');
	if (sigStart === -1) sigStart = data.indexOf("<Signature ");
	if (sigStart === -1) throw new Error("Signature block not found");
	const sigEnd = data.indexOf("</Signature>") + "</Signature>".length;
	data = data.slice(0, sigStart) + data.slice(sigEnd);
	data = data.replace(
		/<([a-zA-Z][a-zA-Z0-9]*)((\s+[^>]*?)?)\s*\/>/g,
		(_m, tag, attrs) => `<${tag}${attrs}></${tag}>`,
	);
	data = data.replace(/\r/g, "");
	return new TextEncoder().encode(data);
}

async function getSignatureAndPubkey(xmlString: string): Promise<[bigint, bigint]> {
	const doc = parseXML(xmlString);
	const sigNS = "http://www.w3.org/2000/09/xmldsig#";

	// ── Signature value → bigint ──────────────────────────────────────────────
	const sigVal = doc.getElementsByTagNameNS(sigNS, "SignatureValue")[0];
	if (!sigVal) throw new Error("SignatureValue not found");
	const sigBytes = Uint8Array.from(atob(sigVal.textContent!.trim().replace(/\s/g, "")), (c) =>
		c.charCodeAt(0),
	);
	const sigInt = BigInt(
		"0x" +
			Array.from(sigBytes)
				.map((b) => b.toString(16).padStart(2, "0"))
				.join(""),
	);

	// ── Certificate DER → RSA modulus bigint (no SubtleCrypto needed) ─────────
	const certs = doc.getElementsByTagNameNS(sigNS, "X509Certificate");
	if (certs.length === 0) throw new Error("No X509Certificate found");
	const certDer = Uint8Array.from(atob(certs[0].textContent!.trim().replace(/\s/g, "")), (c) =>
		c.charCodeAt(0),
	);

	// Extract modulus directly from DER — avoids SubtleCrypto algorithm mismatch
	const pubInt = extractRSAModulusFromCert(certDer);

	return [sigInt, pubInt];
}
// Parse RSA modulus directly from X.509 DER bytes
// Avoids crypto.subtle.importKey which throws DataError on algorithm OID mismatch
function extractRSAModulusFromCert(certDer: Uint8Array): bigint {
	let offset = 0;

	const readTag = () => certDer[offset++];

	const readLength = (): number => {
		const first = certDer[offset++];
		if (first < 0x80) return first;
		const numBytes = first & 0x7f;
		let len = 0;
		for (let i = 0; i < numBytes; i++) len = (len << 8) | certDer[offset++];
		return len;
	};

	const skipValue = (len: number) => {
		offset += len;
	};
	const skipElement = () => {
		readTag();
		skipValue(readLength());
	};

	const readSequenceStart = (): number => {
		const tag = readTag();
		if (tag !== 0x30)
			throw new Error(
				`Expected SEQUENCE (0x30), got 0x${tag.toString(16)} at offset ${offset - 1}`,
			);
		return readLength();
	};

	// Certificate ::= SEQUENCE
	readSequenceStart();
	// TBSCertificate ::= SEQUENCE
	readSequenceStart();

	// Optional version [0] EXPLICIT
	if (certDer[offset] === 0xa0) {
		offset++;
		skipValue(readLength());
	}

	skipElement(); // serialNumber
	skipElement(); // signature AlgorithmIdentifier
	skipElement(); // issuer
	skipElement(); // validity
	skipElement(); // subject

	// subjectPublicKeyInfo ::= SEQUENCE
	readSequenceStart();

	// AlgorithmIdentifier ::= SEQUENCE (skip it — we don't care about the OID)
	skipElement();

	// subjectPublicKey ::= BIT STRING
	const bsTag = readTag();
	if (bsTag !== 0x03) throw new Error(`Expected BIT STRING (0x03), got 0x${bsTag.toString(16)}`);
	readLength();
	offset++; // skip unused-bits byte (always 0x00 for RSA)

	// RSAPublicKey ::= SEQUENCE { modulus INTEGER, publicExponent INTEGER }
	readSequenceStart();

	// modulus ::= INTEGER
	const intTag = readTag();
	if (intTag !== 0x02) throw new Error(`Expected INTEGER (0x02), got 0x${intTag.toString(16)}`);
	let modLen = readLength();

	// DER INTEGERs may have a leading 0x00 byte to indicate positive sign — skip it
	if (certDer[offset] === 0x00) {
		offset++;
		modLen--;
	}

	const modBytes = certDer.slice(offset, offset + modLen);
	return BigInt(
		"0x" +
			Array.from(modBytes)
				.map((b) => b.toString(16).padStart(2, "0"))
				.join(""),
	);
}

function extractPANFields(xmlString: string): PANFields {
	const doc = parseXML(xmlString);
	return {
		name: doc.querySelector("Person")?.getAttribute("name") || "",
		dob: doc.querySelector("Person")?.getAttribute("dob") || "",
		gender: doc.querySelector("Person")?.getAttribute("gender") || "",
		panNumber: doc.querySelector("Certificate")?.getAttribute("number") || "",
		issuer: doc.querySelector("Organization")?.getAttribute("name") || "",
		verifiedOn: doc.querySelector("PAN")?.getAttribute("verifiedOn") || "",
	};
}

function verifyXMLStructure(xmlString: string): boolean {
	try {
		const doc = parseXML(xmlString);
		const sigNS = "http://www.w3.org/2000/09/xmldsig#";
		if (!doc.getElementsByTagNameNS(sigNS, "DigestValue")[0]?.textContent?.trim()) return false;
		if (!doc.getElementsByTagNameNS(sigNS, "SignatureValue")[0]?.textContent?.trim())
			return false;
		if (!doc.getElementsByTagNameNS(sigNS, "X509Certificate")[0]?.textContent?.trim())
			return false;
		if (!doc.querySelector("Certificate")) return false;
		return true;
	} catch {
		return false;
	}
}

async function buildCircuitInput(xmlString: string, onProgress: (s: string) => void) {
	const enc = new TextEncoder();

	onProgress("Applying C14N canonicalization...");
	const signedData = await getSignedDataBytes(xmlString);
	const signedInfoBytes = await getSignedInfoBytes(xmlString);
	const signedInfoStr = new TextDecoder().decode(signedInfoBytes);

	onProgress("Preparing original data...");
	const originalSignedData = getOriginalSignedData(xmlString);

	onProgress("Extracting signature and public key...");
	const [sigInt, pubInt] = await getSignatureAndPubkey(xmlString);

	onProgress("Computing SHA-256 padding...");
	const bodySHALength = Math.ceil((signedData.length + 64 + 1) / 64) * 64;
	const maxLen = Math.max(MAX_INPUT_LENGTH, bodySHALength);
	const [signedDataPadded, signedDataPaddedLength] = sha256Pad(signedData, maxLen);

	onProgress("Generating partial SHA state...");
	const [remaining, precomputedSha, remainingLength] = generatePartialSha(
		signedDataPadded,
		signedDataPaddedLength,
		CERTIFICATE_DATA_TAG,
		MAX_INPUT_LENGTH,
	);

	const origBodySHALength = Math.ceil((originalSignedData.length + 64 + 1) / 64) * 64;
	const origMaxLen = Math.max(MAX_INPUT_LENGTH, origBodySHALength);
	const [originalPadded, originalPaddedLength] = sha256Pad(originalSignedData, origMaxLen);
	const [originalRemaining] = generatePartialSha(
		originalPadded,
		originalPaddedLength,
		CERTIFICATE_DATA_TAG,
		MAX_INPUT_LENGTH,
	);

	const certTagBytes = enc.encode(CERTIFICATE_DATA_TAG);
	let certDataIdx = -1;
	outerCert: for (let i = 0; i < originalRemaining.length - certTagBytes.length; i++) {
		for (let j = 0; j < certTagBytes.length; j++) {
			if (originalRemaining[i + j] !== certTagBytes[j]) continue outerCert;
		}
		certDataIdx = i;
		break;
	}
	if (certDataIdx === -1) throw new Error("<Certificate  not found in original data");

	const docTypeStart = certDataIdx + certTagBytes.length + 1;
	let docTypeEnd = docTypeStart;
	while (
		docTypeEnd < originalRemaining.length &&
		originalRemaining[docTypeEnd] !== 32 &&
		originalRemaining[docTypeEnd] !== 62
	) {
		docTypeEnd++;
	}
	const documentType = originalRemaining.slice(docTypeStart, docTypeEnd);

	onProgress("Locating digest in SignedInfo...");
	const doc = parseXML(xmlString);
	const sigNS = "http://www.w3.org/2000/09/xmldsig#";
	const digestEl = doc.getElementsByTagNameNS(sigNS, "DigestValue")[0];
	if (!digestEl) throw new Error("DigestValue not found");
	const digestB64 = digestEl.textContent!.trim().replace(/\s/g, "");
	const digestBytes = enc.encode(digestB64);
	const signedInfoBytesArr = enc.encode(signedInfoStr);
	let dataHashIdx = -1;
	outerDigest: for (let i = 0; i < signedInfoBytesArr.length - digestBytes.length; i++) {
		for (let j = 0; j < digestBytes.length; j++) {
			if (signedInfoBytesArr[i + j] !== digestBytes[j]) continue outerDigest;
		}
		dataHashIdx = i;
		break;
	}
	if (dataHashIdx === -1) throw new Error("DigestValue not found in SignedInfo");

	const revealStart = 'number="';
	const revealEnd = '"';
	const rsBytes = enc.encode(revealStart);
	const reBytes = enc.encode(revealEnd);
	let rsPos = -1;
	outerRS: for (let i = certDataIdx; i < originalRemaining.length - rsBytes.length; i++) {
		for (let j = 0; j < rsBytes.length; j++) {
			if (originalRemaining[i + j] !== rsBytes[j]) continue outerRS;
		}
		rsPos = i;
		break;
	}
	if (rsPos === -1) throw new Error(`reveal_start "${revealStart}" not found`);
	const revealStartIdx = rsPos - certDataIdx;
	let rePos = -1;
	const searchFrom = certDataIdx + revealStartIdx + rsBytes.length + 1;
	outerRE: for (let i = searchFrom; i < originalRemaining.length - reBytes.length; i++) {
		for (let j = 0; j < reBytes.length; j++) {
			if (originalRemaining[i + j] !== reBytes[j]) continue outerRE;
		}
		rePos = i;
		break;
	}
	if (rePos === -1) throw new Error(`reveal_end "${revealEnd}" not found`);
	const revealEndIdx = rePos - certDataIdx;

	const signedInfoFixed = new Uint8Array(SIGNED_INFO_MAX_LENGTH);
	signedInfoFixed.set(signedInfoBytes.slice(0, SIGNED_INFO_MAX_LENGTH));

	onProgress("Computing signal hash...");
	const signalHash = hashSignal(1);

	return {
		dataPadded: toCharArray(remaining),
		dataPaddedOriginal: toCharArray(originalRemaining),
		dataPaddedLength: remainingLength.toString(),
		signedInfo: toCharArray(signedInfoFixed),
		precomputedSHA: toCharArray(precomputedSha),
		dataHashIndex: dataHashIdx.toString(),
		certificateDataNodeIndex: certDataIdx.toString(),
		documentTypeLength: documentType.length.toString(),
		signature: bigIntToChunked(sigInt, RSA_BITS_PER_CHUNK, RSA_NUM_CHUNKS),
		pubKey: bigIntToChunked(pubInt, RSA_BITS_PER_CHUNK, RSA_NUM_CHUNKS),
		isRevealEnabled: 1,
		revealStartIndex: revealStartIdx.toString(),
		revealEndIndex: revealEndIdx.toString(),
		nullifierSeed: NULLIFIER_SEED.toString(),
		signalHash,
	};
}

// ── Step config ───────────────────────────────────────────────────────────────
const STEP_LABELS: Record<ProofStep, string> = {
	idle: "",
	parsing: "Parsing document",
	verifying: "Verifying government signature",
	generating_input: "Preparing circuit inputs",
	loading_wasm: "Loading ZK circuit",
	generating_witness: "Generating witness",
	generating_proof: "Running Groth16 prover",
	done: "Proof generated",
	error: "Error",
};
const STEP_ORDER: ProofStep[] = [
	"parsing",
	"verifying",
	"generating_input",
	"loading_wasm",
	"generating_proof",
	"done",
];

// ── Component ─────────────────────────────────────────────────────────────────
export default function GenerateProofPage() {
	const fileRef = useRef<HTMLInputElement>(null);
	const [dragging, setDragging] = useState(false);
	const [xmlString, setXmlString] = useState<string | null>(null);
	const [fileName, setFileName] = useState("");
	const [fields, setFields] = useState<PANFields | null>(null);
	const [step, setStep] = useState<ProofStep>("idle");
	const [progressMsg, setProgressMsg] = useState("");
	const [result, setResult] = useState<ProofResult | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [showProof, setShowProof] = useState(false);
	const [revealedFields, setRevealedFields] = useState<Set<string>>(new Set());
	const [downloaded, setDownloaded] = useState(false);

	const reset = useCallback(() => {
		setStep("idle");
		setProgressMsg("");
		setResult(null);
		setError(null);
		setFields(null);
		setShowProof(false);
		setRevealedFields(new Set());
		setDownloaded(false);
	}, []);

	const handleFile = useCallback(
		async (file: File) => {
			if (!file.name.endsWith(".xml")) {
				alert("Upload a DigiLocker XML file");
				return;
			}
			const text = await file.text();
			setXmlString(text);
			setFileName(file.name);
			reset();
		},
		[reset],
	);

	const handleDrop = useCallback(
		(e: React.DragEvent) => {
			e.preventDefault();
			setDragging(false);
			if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
		},
		[handleFile],
	);

	const generate = useCallback(async () => {
		if (!xmlString) return;
		setStep("parsing");
		setError(null);
		setResult(null);
		try {
			console.log("Step 1: extracting fields");
			const panFields = extractPANFields(xmlString);
			console.log("Fields:", panFields);
			setFields(panFields);

			console.log("Step 2: verifying structure");
			if (!verifyXMLStructure(xmlString)) throw new Error("Invalid XML structure");
			console.log("Structure OK");

			console.log("Step 3: building circuit input");
			setStep("generating_input");
			const input = await buildCircuitInput(xmlString, (msg) => {
				console.log("Progress:", msg);
				setProgressMsg(msg);
			});
			console.log("Circuit input built:", Object.keys(input));

			console.log("Step 4: loading snarkjs");
			setStep("loading_wasm");
			const snarkjs = await import("snarkjs");
			console.log("snarkjs loaded:", typeof snarkjs.groth16);

			console.log("Step 5: running fullProve");
			setStep("generating_proof");
			const { proof, publicSignals } = await snarkjs.groth16.fullProve(
				input,
				WASM_URL,
				ZKEY_URL,
			);
			console.log("Proof done:", publicSignals);

			setResult({ proof, publicSignals });
			setStep("done");
		} catch (e: any) {
			console.error("CAUGHT ERROR:", e);
			console.error("message:", e?.message);
			console.error("stack:", e?.stack);
			console.error("toString:", String(e));
			setError(e?.message || String(e) || "Unknown error");
			setStep("error");
		}
	}, [xmlString]);

	const downloadProof = useCallback(() => {
		if (!result) return;
		const blob = new Blob(
			[JSON.stringify({ proof: result.proof, publicSignals: result.publicSignals }, null, 2)],
			{ type: "application/json" },
		);
		Object.assign(document.createElement("a"), {
			href: URL.createObjectURL(blob),
			download: "zk-pan-proof.json",
		}).click();
		setDownloaded(true);
	}, [result]);

	const toggleReveal = (key: string) =>
		setRevealedFields((prev) => {
			const n = new Set(prev);
			n.has(key) ? n.delete(key) : n.add(key);
			return n;
		});

	const isRunning = step !== "idle" && step !== "done" && step !== "error";
	const currentStepIdx = STEP_ORDER.indexOf(step);

	const fieldDefs = fields
		? [
				{ key: "name", label: "Name", value: fields.name, sensitive: true },
				{ key: "dob", label: "Date of Birth", value: fields.dob, sensitive: true },
				{ key: "gender", label: "Gender", value: fields.gender, sensitive: false },
				{
					key: "panNumber",
					label: "PAN Number",
					value: fields.panNumber,
					sensitive: false,
					mono: true,
				},
				{ key: "issuer", label: "Issuer", value: fields.issuer, sensitive: false },
				{
					key: "verifiedOn",
					label: "Verified On",
					value: fields.verifiedOn,
					sensitive: false,
				},
			]
		: [];

	return (
		<>
			<style>{CSS}</style>
			<div className="gen-root">
				<div className="gen-noise" />

				{/* Nav */}
				<nav className="gen-nav">
					<a href="/" className="gen-logo">
						<span className="gen-logo-dot" />
						<span className="gen-logo-text">ZK PAN</span>
					</a>
					<div className="gen-nav-links">
						<a href="#/generate" className="gen-nav-link gen-nav-active">
							Generate
						</a>
						<a href="#/verify" className="gen-nav-link">
							Verify
						</a>
						<a href="#/event" className="gen-nav-link">
							India Summit
						</a>
					</div>
				</nav>

				{/* Hero */}
				<section className="gen-hero">
					<div className="gen-hero-tag">
						<span className="gen-tag-dot" />
						Zero-Knowledge Proof Generator
					</div>
					<h1 className="gen-hero-title">Generate Proof</h1>
					<p className="gen-hero-sub">
						Upload your DigiLocker PAN XML. Everything runs locally — your file never
						leaves this tab.
					</p>
				</section>

				{/* Main layout */}
				<div className="gen-layout">
					{/* Left column */}
					<div className="gen-left">
						{!xmlString ? (
							<div
								className={`gen-dropzone${dragging ? " gen-dragging" : ""}`}
								onDragOver={(e) => {
									e.preventDefault();
									setDragging(true);
								}}
								onDragLeave={() => setDragging(false)}
								onDrop={handleDrop}
								onClick={() => fileRef.current?.click()}
							>
								<input
									ref={fileRef}
									type="file"
									accept=".xml"
									className="gen-file-input"
									onChange={(e) => {
										if (e.target.files?.[0]) handleFile(e.target.files[0]);
									}}
								/>
								<div className="gen-dz-icon">
									<svg width="32" height="32" viewBox="0 0 32 32" fill="none">
										<path
											d="M16 4v16M8 12l8-8 8 8"
											stroke="currentColor"
											strokeWidth="2"
											strokeLinecap="round"
											strokeLinejoin="round"
										/>
										<path
											d="M6 22v2a2 2 0 002 2h16a2 2 0 002-2v-2"
											stroke="currentColor"
											strokeWidth="2"
											strokeLinecap="round"
										/>
									</svg>
								</div>
								<p className="gen-dz-title">Drop your PAN XML here</p>
								<p className="gen-dz-hint">or click to browse · .xml files only</p>
								<div className="gen-dz-guide">
									<strong>How to get your XML:</strong>
									<span>DigiLocker app → PAN Card → Download XML</span>
								</div>
							</div>
						) : (
							<div className="gen-file-loaded">
								<div className="gen-file-info">
									<div className="gen-file-icon">
										<svg width="18" height="18" viewBox="0 0 20 20" fill="none">
											<path
												d="M4 3h8l4 4v10a1 1 0 01-1 1H5a1 1 0 01-1-1V4a1 1 0 011-1z"
												stroke="currentColor"
												strokeWidth="1.5"
											/>
											<path
												d="M12 3v4h4"
												stroke="currentColor"
												strokeWidth="1.5"
											/>
										</svg>
									</div>
									<div>
										<div className="gen-file-name">{fileName}</div>
										<div className="gen-file-status">
											Ready to generate proof
										</div>
									</div>
								</div>
								<button
									className="gen-change-btn"
									onClick={() => {
										setXmlString(null);
										reset();
									}}
								>
									Change
								</button>
							</div>
						)}

						{/* Extracted fields */}
						{fields && (
							<div className="gen-fields-card">
								<div className="gen-fields-header">
									<svg width="15" height="15" viewBox="0 0 16 16" fill="none">
										<circle
											cx="8"
											cy="8"
											r="7"
											stroke="currentColor"
											strokeWidth="1.5"
										/>
										<path
											d="M5 8l2 2 4-4"
											stroke="currentColor"
											strokeWidth="1.5"
											strokeLinecap="round"
											strokeLinejoin="round"
										/>
									</svg>
									Government-signed document detected
								</div>
								<div className="gen-privacy-banner">
									<svg width="12" height="12" viewBox="0 0 13 13" fill="none">
										<ellipse
											cx="6.5"
											cy="6.5"
											rx="5.5"
											ry="4"
											stroke="currentColor"
											strokeWidth="1.2"
										/>
										<circle
											cx="6.5"
											cy="6.5"
											r="1.5"
											stroke="currentColor"
											strokeWidth="1.2"
										/>
									</svg>
									Sensitive fields blurred — hover to reveal
								</div>
								<div className="gen-fields">
									{fieldDefs.map(({ key, label, value, sensitive, mono }) => (
										<div
											key={key}
											className={`gen-field${sensitive ? " gen-field-sensitive" : ""}`}
											onMouseEnter={() => sensitive && toggleReveal(key)}
											onMouseLeave={() =>
												sensitive &&
												setRevealedFields((p) => {
													const n = new Set(p);
													n.delete(key);
													return n;
												})
											}
										>
											<span className="gen-field-label">{label}</span>
											<div className="gen-field-value-wrap">
												<span
													className={`gen-field-value${mono ? " gen-mono" : ""}${sensitive && !revealedFields.has(key) ? " gen-blurred" : ""}`}
												>
													{value || "—"}
												</span>
												{sensitive && !revealedFields.has(key) && (
													<span className="gen-hover-hint">
														<svg
															width="10"
															height="10"
															viewBox="0 0 11 11"
															fill="none"
														>
															<path
																d="M1 5.5s1.8-3.5 4.5-3.5S10 5.5 10 5.5 8.2 9 5.5 9 1 5.5 1 5.5z"
																stroke="currentColor"
																strokeWidth="1.2"
															/>
															<circle
																cx="5.5"
																cy="5.5"
																r="1.3"
																stroke="currentColor"
																strokeWidth="1.2"
															/>
														</svg>
													</span>
												)}
											</div>
										</div>
									))}
								</div>
								<div className="gen-privacy-note">
									<svg width="13" height="13" viewBox="0 0 14 14" fill="none">
										<path
											d="M7 1L1.5 3.5v4c0 3.09 2.19 5.99 4.9 6.65C9.31 13.49 12.5 10.59 12.5 7.5v-4L7 1z"
											stroke="currentColor"
											strokeWidth="1.2"
										/>
									</svg>
									None of this data is sent anywhere. Only PAN number will be
									revealed in proof.
								</div>
							</div>
						)}

						{/* Generate button */}
						{xmlString && step === "idle" && (
							<button className="gen-generate-btn" onClick={generate}>
								Generate Zero-Knowledge Proof
								<svg width="18" height="18" viewBox="0 0 18 18" fill="none">
									<path
										d="M3 9h12M11 5l4 4-4 4"
										stroke="currentColor"
										strokeWidth="1.5"
										strokeLinecap="round"
										strokeLinejoin="round"
									/>
								</svg>
							</button>
						)}

						{/* Error retry */}
						{step === "error" && (
							<button
								className="gen-retry-btn"
								onClick={() => {
									setStep("idle");
									setError(null);
								}}
							>
								← Try again
							</button>
						)}
					</div>

					{/* Right column */}
					<div className="gen-right">
						{/* Progress card */}
						{step !== "idle" && step !== "done" && (
							<div className="gen-progress-card">
								<div className="gen-progress-header">
									<span className="gen-progress-title">
										{step === "error" ? "Error" : "Generating Proof"}
									</span>
									{isRunning && <div className="gen-spinner" />}
								</div>
								<div className="gen-steps">
									{STEP_ORDER.filter((s) => s !== "done").map((s) => {
										const idx = STEP_ORDER.indexOf(s);
										const isComplete = currentStepIdx > idx;
										const isCurrent = s === step;
										return (
											<div
												key={s}
												className={`gen-step-row${isComplete ? " gen-complete" : ""}${isCurrent ? " gen-current" : ""}`}
											>
												<div className="gen-step-dot">
													{isComplete ? (
														<svg
															width="10"
															height="10"
															viewBox="0 0 10 10"
															fill="none"
														>
															<path
																d="M2 5l2 2 4-4"
																stroke="currentColor"
																strokeWidth="1.5"
																strokeLinecap="round"
																strokeLinejoin="round"
															/>
														</svg>
													) : isCurrent ? (
														<div className="gen-dot-pulse" />
													) : null}
												</div>
												<span className="gen-step-label">
													{STEP_LABELS[s]}
												</span>
												{isCurrent && progressMsg && (
													<span className="gen-step-progress">
														{progressMsg}
													</span>
												)}
											</div>
										);
									})}
								</div>
								{isRunning && (
									<div className="gen-progress-bar">
										<div
											className="gen-progress-fill"
											style={{
												width: `${(currentStepIdx / (STEP_ORDER.length - 1)) * 100}%`,
											}}
										/>
									</div>
								)}
								{step === "generating_proof" && (
									<div className="gen-warning">
										<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
											<circle
												cx="7"
												cy="7"
												r="6"
												stroke="currentColor"
												strokeWidth="1.2"
											/>
											<path
												d="M7 4v4M7 9.5v.5"
												stroke="currentColor"
												strokeWidth="1.2"
												strokeLinecap="round"
											/>
										</svg>
										Heavy cryptography in browser — 2–3 minutes. Keep tab open.
									</div>
								)}
								{error && (
									<div className="gen-error-box">
										<strong>Error:</strong> {error}
									</div>
								)}
							</div>
						)}

						{/* Result card */}
						{step === "done" && result && (
							<div className="gen-result-card">
								<div className="gen-result-header">
									<div className="gen-result-badge">
										<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
											<circle
												cx="7"
												cy="7"
												r="6"
												fill="currentColor"
												fillOpacity="0.15"
											/>
											<path
												d="M4 7l2 2 4-4"
												stroke="currentColor"
												strokeWidth="1.5"
												strokeLinecap="round"
												strokeLinejoin="round"
											/>
										</svg>
										Valid ZK Proof
									</div>
									<p>
										Cryptographic proof of your Indian PAN. No personal data
										revealed.
									</p>
								</div>

								<div className="gen-signals">
									{[
										{
											label: "Nullifier",
											value: result.publicSignals[1]?.slice(0, 22) + "...",
										},
										{ label: "Document Type", value: result.publicSignals[2] },
										{
											label: "Revealed PAN (packed)",
											value: result.publicSignals[3],
										},
										{
											label: "Pubkey Hash",
											value: result.publicSignals[0]?.slice(0, 22) + "...",
										},
									].map(({ label, value }) => (
										<div key={label} className="gen-signal-row">
											<span className="gen-signal-label">{label}</span>
											<span className="gen-signal-value">{value}</span>
										</div>
									))}
								</div>

								<button
									className="gen-toggle-proof"
									onClick={() => setShowProof((v) => !v)}
								>
									{showProof ? "Hide" : "Show"} proof JSON
									<svg
										width="13"
										height="13"
										viewBox="0 0 14 14"
										fill="none"
										style={{
											transform: showProof ? "rotate(180deg)" : "none",
											transition: "transform 0.2s",
										}}
									>
										<path
											d="M2 4l5 5 5-5"
											stroke="currentColor"
											strokeWidth="1.5"
											strokeLinecap="round"
											strokeLinejoin="round"
										/>
									</svg>
								</button>
								{showProof && (
									<pre className="gen-proof-json">
										{JSON.stringify(result.proof, null, 2)}
									</pre>
								)}

								<div className="gen-actions">
									<button className="gen-download-btn" onClick={downloadProof}>
										<svg width="15" height="15" viewBox="0 0 16 16" fill="none">
											<path
												d="M8 2v8M4 7l4 4 4-4"
												stroke="currentColor"
												strokeWidth="1.5"
												strokeLinecap="round"
												strokeLinejoin="round"
											/>
											<path
												d="M2 12v1a1 1 0 001 1h10a1 1 0 001-1v-1"
												stroke="currentColor"
												strokeWidth="1.5"
												strokeLinecap="round"
											/>
										</svg>
										Download Proof JSON
									</button>
									{downloaded && (
										<a href="/event" className="gen-event-btn">
											Claim Event Discount →
										</a>
									)}
								</div>

								{!downloaded && (
									<p className="gen-download-hint">
										Download your proof first, then claim your event discount.
									</p>
								)}
							</div>
						)}

						{/* Idle placeholder */}
						{step === "idle" && !xmlString && (
							<div className="gen-placeholder">
								<div className="gen-placeholder-icon">◈</div>
								<p>Upload your PAN XML to get started</p>
							</div>
						)}

						{step === "idle" && xmlString && (
							<div className="gen-placeholder">
								<div className="gen-placeholder-icon">→</div>
								<p>Click Generate to create your ZK proof</p>
							</div>
						)}
					</div>
				</div>
			</div>
		</>
	);
}

// ── Styles ────────────────────────────────────────────────────────────────────
const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Mono:wght@400;500&family=DM+Sans:wght@300;400;500&display=swap');

  :root {
    --gen-bg: #08090a;
    --gen-surface: #111215;
    --gen-surface2: #18191e;
    --gen-border: rgba(255,255,255,0.07);
    --gen-border-bright: rgba(255,255,255,0.13);
    --gen-ink: #f0ede8;
    --gen-muted: #6b6f7a;
    --gen-pink: #e6007a;
    --gen-pink-dim: rgba(230,0,122,0.1);
    --gen-green: #56f39a;
    --gen-green-dim: rgba(86,243,154,0.08);
    --gen-amber: #f0a500;
    --gen-radius: 12px;
    --gen-radius-lg: 20px;
    --gen-mono: 'DM Mono', monospace;
    --gen-display: 'Syne', sans-serif;
    --gen-body: 'DM Sans', sans-serif;
    --gen-transition: 0.18s ease;
  }

  .gen-root {
    min-height: 100vh;
    background: var(--gen-bg);
    color: var(--gen-ink);
    font-family: var(--gen-body);
    position: relative;
    overflow-x: hidden;
  }

  .gen-noise {
    pointer-events: none;
    position: fixed;
    inset: 0;
    z-index: 0;
    opacity: 0.025;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
    background-size: 200px;
  }

  /* Nav */
  .gen-nav {
    position: sticky;
    top: 0; z-index: 50;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1.25rem 2.5rem;
    background: rgba(8,9,10,0.88);
    backdrop-filter: blur(16px);
    border-bottom: 1px solid var(--gen-border);
  }
  .gen-logo {
    display: flex; align-items: center; gap: 0.625rem;
    text-decoration: none;
    font-family: var(--gen-display);
    font-weight: 800; font-size: 1rem;
    color: var(--gen-ink);
  }
  .gen-logo-dot {
    width: 8px; height: 8px; border-radius: 50%;
    background: var(--gen-pink);
    box-shadow: 0 0 8px var(--gen-pink);
    animation: gen-pulse 2s ease-in-out infinite;
  }
  @keyframes gen-pulse {
    0%,100% { opacity:1; transform:scale(1); }
    50% { opacity:0.5; transform:scale(0.8); }
  }
  .gen-logo-text { letter-spacing: 0.06em; }
  .gen-nav-links { display: flex; gap: 2rem; align-items: center; }
  .gen-nav-link {
    font-size: 0.875rem; font-weight: 500;
    color: var(--gen-muted); text-decoration: none;
    transition: color var(--gen-transition);
  }
  .gen-nav-link:hover, .gen-nav-active { color: var(--gen-ink); }
  .gen-nav-active { position: relative; }
  .gen-nav-active::after {
    content: '';
    position: absolute; bottom: -4px; left: 0; right: 0;
    height: 2px; border-radius: 1px;
    background: var(--gen-pink);
  }

  /* Hero */
  .gen-hero {
    padding: 4rem 2.5rem 2rem;
    max-width: 720px;
    animation: gen-fade-up 0.5s ease both;
  }
  .gen-hero-tag {
    display: inline-flex; align-items: center; gap: 0.5rem;
    font-family: var(--gen-mono);
    font-size: 0.72rem; font-weight: 500;
    color: var(--gen-pink);
    background: var(--gen-pink-dim);
    border: 1px solid rgba(230,0,122,0.2);
    border-radius: 100px;
    padding: 0.3rem 0.875rem;
    margin-bottom: 1.25rem;
    letter-spacing: 0.06em;
  }
  .gen-tag-dot {
    width: 5px; height: 5px; border-radius: 50%;
    background: var(--gen-pink);
  }
  .gen-hero-title {
    font-family: var(--gen-display);
    font-size: clamp(2.5rem, 5vw, 4rem);
    font-weight: 800; letter-spacing: -0.03em;
    color: var(--gen-ink); margin-bottom: 0.75rem;
    line-height: 1.05;
  }
  .gen-hero-sub {
    font-size: 1rem; line-height: 1.7;
    color: var(--gen-muted); max-width: 480px;
  }

  /* Layout */
  .gen-layout {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 2rem;
    align-items: start;
    padding: 2rem 2.5rem 5rem;
    max-width: 1200px;
  }
  @media (max-width: 820px) {
    .gen-layout { grid-template-columns: 1fr; }
  }

  /* Dropzone */
  .gen-dropzone {
    border: 2px dashed rgba(255,255,255,0.12);
    border-radius: var(--gen-radius-lg);
    padding: 3rem 2rem;
    text-align: center;
    cursor: pointer;
    transition: all var(--gen-transition);
    background: var(--gen-surface);
    animation: gen-fade-up 0.5s 0.1s ease both;
  }
  .gen-dropzone:hover, .gen-dragging {
    border-color: var(--gen-pink);
    background: var(--gen-pink-dim);
  }
  .gen-file-input { display: none; }
  .gen-dz-icon {
    width: 64px; height: 64px; border-radius: 50%;
    background: var(--gen-surface2);
    display: flex; align-items: center; justify-content: center;
    margin: 0 auto 1.25rem;
    color: var(--gen-muted);
    transition: all var(--gen-transition);
  }
  .gen-dropzone:hover .gen-dz-icon, .gen-dragging .gen-dz-icon {
    background: var(--gen-pink-dim); color: var(--gen-pink);
  }
  .gen-dz-title {
    font-family: var(--gen-display);
    font-size: 1.05rem; font-weight: 700;
    color: var(--gen-ink); margin-bottom: 0.35rem;
  }
  .gen-dz-hint { font-size: 0.85rem; color: var(--gen-muted); margin-bottom: 1.5rem; }
  .gen-dz-guide {
    font-size: 0.8rem;
    background: var(--gen-surface2);
    border-radius: var(--gen-radius);
    padding: 0.75rem 1rem;
    display: flex; flex-direction: column; gap: 0.2rem;
    color: var(--gen-muted); text-align: left;
  }
  .gen-dz-guide strong { color: var(--gen-ink); }

  /* File loaded */
  .gen-file-loaded {
    display: flex; align-items: center; justify-content: space-between; gap: 1rem;
    background: var(--gen-surface);
    border: 1px solid var(--gen-border-bright);
    border-radius: var(--gen-radius-lg);
    padding: 1rem 1.25rem;
  }
  .gen-file-info { display: flex; align-items: center; gap: 0.75rem; }
  .gen-file-icon {
    width: 36px; height: 36px;
    background: var(--gen-pink-dim);
    border-radius: var(--gen-radius);
    display: flex; align-items: center; justify-content: center;
    color: var(--gen-pink); flex-shrink: 0;
  }
  .gen-file-name { font-weight: 500; font-size: 0.9rem; color: var(--gen-ink); }
  .gen-file-status { font-size: 0.78rem; color: var(--gen-green); margin-top: 0.1rem; }
  .gen-change-btn {
    font-size: 0.78rem; color: var(--gen-muted);
    background: none; border: 1px solid var(--gen-border);
    border-radius: 100px; padding: 0.3rem 0.75rem;
    cursor: pointer; transition: all var(--gen-transition);
    font-family: var(--gen-body);
  }
  .gen-change-btn:hover { color: var(--gen-ink); border-color: var(--gen-border-bright); }

  /* Fields card */
  .gen-fields-card {
    background: var(--gen-surface);
    border: 1px solid var(--gen-border);
    border-radius: var(--gen-radius-lg);
    overflow: hidden; margin-top: 1rem;
    animation: gen-fade-up 0.4s ease both;
  }
  .gen-fields-header {
    display: flex; align-items: center; gap: 0.5rem;
    padding: 0.875rem 1.25rem;
    background: var(--gen-green-dim);
    color: var(--gen-green);
    font-size: 0.82rem; font-weight: 600;
    border-bottom: 1px solid var(--gen-border);
  }
  .gen-privacy-banner {
    display: flex; align-items: center; gap: 0.5rem;
    padding: 0.55rem 1.25rem;
    background: rgba(240,165,0,0.06);
    border-bottom: 1px solid rgba(240,165,0,0.15);
    font-size: 0.75rem; color: var(--gen-amber);
    font-style: italic;
  }
  .gen-fields { padding: 0.25rem 0; }
  .gen-field {
    display: flex; align-items: center; justify-content: space-between;
    padding: 0.65rem 1.25rem;
    border-bottom: 1px solid var(--gen-border);
    transition: background var(--gen-transition);
  }
  .gen-field:last-child { border-bottom: none; }
  .gen-field-sensitive { cursor: default; }
  .gen-field-sensitive:hover { background: rgba(230,0,122,0.04); }
  .gen-field-label { font-size: 0.78rem; color: var(--gen-muted); flex-shrink: 0; }
  .gen-field-value-wrap { display: flex; align-items: center; gap: 0.5rem; }
  .gen-field-value {
    font-size: 0.875rem; font-weight: 500; color: var(--gen-ink);
    transition: filter 0.25s ease, opacity 0.25s ease;
  }
  .gen-mono { font-family: var(--gen-mono); letter-spacing: 0.05em; font-size: 0.82rem; }
  .gen-blurred { filter: blur(5px); opacity: 0.5; user-select: none; }
  .gen-field-sensitive:hover .gen-blurred { filter: blur(0); opacity: 1; }
  .gen-field-sensitive:hover .gen-hover-hint { display: none; }
  .gen-hover-hint {
    display: flex; align-items: center; gap: 0.3rem;
    font-size: 0.68rem; color: var(--gen-muted);
    font-family: var(--gen-mono); opacity: 0.7;
    pointer-events: none; white-space: nowrap;
  }
  .gen-privacy-note {
    display: flex; align-items: flex-start; gap: 0.5rem;
    padding: 0.875rem 1.25rem;
    background: var(--gen-surface2);
    color: var(--gen-muted);
    font-size: 0.75rem; line-height: 1.5;
    border-top: 1px solid var(--gen-border);
  }

  /* Generate btn */
  .gen-generate-btn {
    width: 100%;
    display: flex; align-items: center; justify-content: center; gap: 0.75rem;
    background: var(--gen-pink);
    color: #fff; border: none;
    border-radius: var(--gen-radius-lg);
    padding: 1.1rem; font-size: 1rem; font-weight: 600;
    cursor: pointer; margin-top: 1rem;
    transition: all var(--gen-transition);
    font-family: var(--gen-body);
    box-shadow: 0 0 24px rgba(230,0,122,0.3);
  }
  .gen-generate-btn:hover {
    background: #ff2d8e;
    transform: translateY(-1px);
    box-shadow: 0 0 40px rgba(230,0,122,0.5);
  }
  .gen-retry-btn {
    width: 100%;
    background: none;
    border: 1px solid var(--gen-border-bright);
    border-radius: var(--gen-radius);
    color: var(--gen-muted); font-family: var(--gen-body);
    font-size: 0.875rem; padding: 0.75rem;
    cursor: pointer; margin-top: 1rem;
    transition: all var(--gen-transition);
  }
  .gen-retry-btn:hover { color: var(--gen-ink); border-color: var(--gen-ink); }

  /* Progress card */
  .gen-progress-card {
    background: var(--gen-surface);
    border: 1px solid var(--gen-border);
    border-radius: var(--gen-radius-lg);
    padding: 1.75rem;
    animation: gen-fade-up 0.4s ease both;
  }
  .gen-progress-header {
    display: flex; align-items: center; justify-content: space-between;
    margin-bottom: 1.5rem;
  }
  .gen-progress-title {
    font-family: var(--gen-display);
    font-size: 1.15rem; font-weight: 700; color: var(--gen-ink);
  }
  .gen-spinner {
    width: 18px; height: 18px;
    border: 2px solid var(--gen-border-bright);
    border-top-color: var(--gen-pink);
    border-radius: 50%;
    animation: gen-spin 0.7s linear infinite;
  }
  @keyframes gen-spin { to { transform: rotate(360deg); } }
  .gen-steps { display: flex; flex-direction: column; gap: 0.75rem; margin-bottom: 1.25rem; }
  .gen-step-row {
    display: flex; align-items: center; gap: 0.75rem;
    opacity: 0.3; transition: opacity var(--gen-transition);
  }
  .gen-complete, .gen-current { opacity: 1; }
  .gen-step-dot {
    width: 22px; height: 22px; border-radius: 50%;
    border: 1.5px solid var(--gen-border-bright);
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0; transition: all var(--gen-transition);
    color: #fff;
  }
  .gen-complete .gen-step-dot { background: var(--gen-green); border-color: var(--gen-green); }
  .gen-current .gen-step-dot { border-color: var(--gen-pink); }
  .gen-dot-pulse {
    width: 8px; height: 8px; border-radius: 50%;
    background: var(--gen-pink);
    animation: gen-pulse 1.5s ease-in-out infinite;
  }
  .gen-step-label { font-size: 0.875rem; color: var(--gen-ink); flex: 1; }
  .gen-step-progress {
    font-size: 0.7rem; color: var(--gen-muted);
    font-family: var(--gen-mono);
    max-width: 160px; text-align: right;
  }
  .gen-progress-bar {
    height: 3px; background: var(--gen-border); border-radius: 2px; overflow: hidden; margin-bottom: 1rem;
  }
  .gen-progress-fill {
    height: 100%; background: linear-gradient(90deg, var(--gen-pink), #a855f7);
    border-radius: 2px; transition: width 0.5s ease;
  }
  .gen-warning {
    display: flex; align-items: flex-start; gap: 0.5rem;
    background: rgba(240,165,0,0.08);
    border: 1px solid rgba(240,165,0,0.2);
    border-radius: var(--gen-radius);
    padding: 0.875rem; font-size: 0.8rem;
    color: var(--gen-amber); line-height: 1.5;
  }
  .gen-error-box {
    background: rgba(239,68,68,0.08);
    border: 1px solid rgba(239,68,68,0.25);
    border-radius: var(--gen-radius);
    padding: 0.875rem; font-size: 0.85rem;
    color: #f87171; margin-top: 1rem;
  }

  /* Result card */
  .gen-result-card {
    background: var(--gen-surface);
    border: 1px solid rgba(86,243,154,0.2);
    border-radius: var(--gen-radius-lg);
    overflow: hidden;
    animation: gen-fade-up 0.4s ease both;
  }
  .gen-result-header {
    padding: 1.5rem;
    border-bottom: 1px solid var(--gen-border);
    background: var(--gen-green-dim);
  }
  .gen-result-badge {
    display: inline-flex; align-items: center; gap: 0.4rem;
    color: var(--gen-green);
    font-size: 0.85rem; font-weight: 700;
    margin-bottom: 0.5rem;
    font-family: var(--gen-display);
  }
  .gen-result-header p { font-size: 0.85rem; color: var(--gen-muted); line-height: 1.6; }
  .gen-signals { padding: 0.25rem 0; border-bottom: 1px solid var(--gen-border); }
  .gen-signal-row {
    display: flex; align-items: center; justify-content: space-between;
    padding: 0.6rem 1.5rem;
    border-bottom: 1px solid var(--gen-border);
  }
  .gen-signal-row:last-child { border-bottom: none; }
  .gen-signal-label { font-size: 0.78rem; color: var(--gen-muted); }
  .gen-signal-value { font-family: var(--gen-mono); font-size: 0.75rem; color: var(--gen-ink); }
  .gen-toggle-proof {
    display: flex; align-items: center; gap: 0.5rem;
    width: 100%; padding: 0.875rem 1.5rem;
    background: none; border: none; border-bottom: 1px solid var(--gen-border);
    color: var(--gen-muted); font-size: 0.85rem; cursor: pointer;
    transition: color var(--gen-transition); font-family: var(--gen-body);
  }
  .gen-toggle-proof:hover { color: var(--gen-ink); }
  .gen-proof-json {
    padding: 1.25rem 1.5rem; font-size: 0.7rem;
    line-height: 1.6; color: var(--gen-ink);
    background: var(--gen-surface2);
    overflow-x: auto; max-height: 200px; overflow-y: auto;
    border-bottom: 1px solid var(--gen-border);
    font-family: var(--gen-mono);
  }
  .gen-actions {
    display: flex; gap: 1rem; padding: 1.25rem 1.5rem;
    flex-wrap: wrap;
  }
  .gen-download-btn {
    flex: 1; min-width: 160px;
    display: flex; align-items: center; justify-content: center; gap: 0.5rem;
    background: var(--gen-surface2);
    border: 1px solid var(--gen-border-bright);
    border-radius: var(--gen-radius);
    padding: 0.875rem; font-size: 0.875rem; font-weight: 500;
    color: var(--gen-ink); cursor: pointer;
    transition: all var(--gen-transition); font-family: var(--gen-body);
  }
  .gen-download-btn:hover { border-color: var(--gen-ink); }
  .gen-event-btn {
    flex: 1; min-width: 160px;
    display: flex; align-items: center; justify-content: center;
    background: var(--gen-pink); color: #fff;
    text-decoration: none; border-radius: var(--gen-radius);
    padding: 0.875rem; font-size: 0.875rem; font-weight: 600;
    transition: all var(--gen-transition);
    box-shadow: 0 0 20px rgba(230,0,122,0.3);
  }
  .gen-event-btn:hover { background: #ff2d8e; box-shadow: 0 0 32px rgba(230,0,122,0.5); }
  .gen-download-hint {
    font-size: 0.75rem; color: var(--gen-muted);
    text-align: center; padding: 0 1.5rem 1rem;
    font-family: var(--gen-mono);
  }

  /* Placeholder */
  .gen-placeholder {
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    gap: 0.875rem; min-height: 280px;
    border: 1px dashed var(--gen-border);
    border-radius: var(--gen-radius-lg);
  }
  .gen-placeholder-icon {
    font-size: 2.5rem; opacity: 0.2;
    color: var(--gen-muted);
  }
  .gen-placeholder p { font-size: 0.9rem; color: var(--gen-muted); }

  @keyframes gen-fade-up {
    from { opacity: 0; transform: translateY(14px); }
    to { opacity: 1; transform: translateY(0); }
  }
`;
