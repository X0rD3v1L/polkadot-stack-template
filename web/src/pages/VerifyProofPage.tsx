import { useState, useRef, useCallback, useEffect } from "react";
import { createPublicClient, createWalletClient, custom, http } from "viem";

// ── Chain + contract config ───────────────────────────────────────────────────

const RPC_URL = "https://services.polkadothub-rpc.com/testnet";
const PAN_ATTESTER_ADDRESS = "0xadeeaa7a41ef851a1edc691b5e399305bdff77e4" as const;
const ATTESTATION_REGISTRY = "0x4d018c530e01bbc98b042a18a4d4090658bcd8f3" as const;
const SCHEMA = "0x1f70926f006bbe27dee4902c852a268b648b358bebc8eeb42e524004752ead18" as const;

const paseoAssetHub = {
  id: 420420417,
  name: "Paseo Asset Hub",
  nativeCurrency: { name: "PAS", symbol: "PAS", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
} as const;

const PAN_ATTESTER_ABI = [
  {
    name: "verifyAndAttest", type: "function", stateMutability: "nonpayable",
    inputs: [
      { name: "nullifier", type: "uint256" }, { name: "documentType", type: "uint256" },
      { name: "reveal", type: "uint256" }, { name: "signal", type: "uint256" },
      { name: "groth16Proof", type: "uint256[8]" },
    ], outputs: [],
  },
  {
    name: "hasValidAttestation", type: "function", stateMutability: "view",
    inputs: [{ name: "user", type: "address" }], outputs: [{ type: "bool" }],
  },
  {
    name: "isNullifierUsed", type: "function", stateMutability: "view",
    inputs: [{ name: "nullifier", type: "uint256" }], outputs: [{ type: "bool" }],
  },
  {
    name: "getNullifierByAddress", type: "function", stateMutability: "view",
    inputs: [{ name: "user", type: "address" }], outputs: [{ type: "uint256" }],
  },
] as const;

const REGISTRY_ABI = [
  {
    name: "isValid", type: "function", stateMutability: "view",
    inputs: [
      { name: "subject", type: "address" }, { name: "schema", type: "bytes32" },
      { name: "attester", type: "address" },
    ], outputs: [{ type: "bool" }],
  },
] as const;

// ── Types ─────────────────────────────────────────────────────────────────────

interface ProofData {
  proof: { pi_a: string[]; pi_b: string[][]; pi_c: string[] };
  publicSignals: string[];
}

interface CheckResult {
  hasAttestation: boolean;
  isValid: boolean;
  nullifier: bigint;
}

type Step = "idle" | "checking" | "submitting" | "done" | "error";

interface DetectedWallet {
  id: string;
  name: string;
  icon: string;
  provider: () => any;
  installed: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function packGroth16Proof(
  p: ProofData["proof"]
): readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint] {
  return [
    BigInt(p.pi_a[0]), BigInt(p.pi_a[1]),
    BigInt(p.pi_b[0][1]), BigInt(p.pi_b[0][0]),
    BigInt(p.pi_b[1][1]), BigInt(p.pi_b[1][0]),
    BigInt(p.pi_c[0]), BigInt(p.pi_c[1]),
  ];
}

function decodePackedBytes(val: string): string {
  try {
    let n = BigInt(val);
    if (n === 0n) return "—";
    let r = "";
    while (n > 0n) {
      const c = Number(n & 0xffn);
      if (c > 31 && c < 127) r = r + String.fromCharCode(c);
      n >>= 8n;
    }
    return r || val;
  } catch { return val; }
}

function getPublicClient() {
  return createPublicClient({ transport: http(RPC_URL), chain: paseoAssetHub as any });
}

function detectWallets(): DetectedWallet[] {
  const eth = (window as any).ethereum;
  const wallets: DetectedWallet[] = [
    {
      id: "metamask", name: "MetaMask", icon: "🦊",
      provider: () => eth?.providers?.find((p: any) => p.isMetaMask) ?? (eth?.isMetaMask ? eth : null),
      installed: !!(eth?.isMetaMask || eth?.providers?.some((p: any) => p.isMetaMask)),
    },
    {
      id: "talisman", name: "Talisman", icon: "🔮",
      provider: () => eth?.providers?.find((p: any) => p.isTalisman) ?? (eth?.isTalisman ? eth : null),
      installed: !!(eth?.isTalisman || eth?.providers?.some((p: any) => p.isTalisman)),
    },
    {
      id: "subwallet", name: "SubWallet", icon: "🪐",
      provider: () => eth?.providers?.find((p: any) => p.isSubWallet) ?? (eth?.isSubWallet ? eth : null),
      installed: !!(eth?.isSubWallet || eth?.providers?.some((p: any) => p.isSubWallet)),
    },
    {
      id: "injected", name: "Browser Wallet", icon: "🌐",
      provider: () => eth,
      installed: !!eth,
    },
  ];
  const hasSpecific = wallets.slice(0, 3).some((w) => w.installed);
  return wallets.filter((w) => w.id !== "injected" || !hasSpecific);
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function VerifyProofPage() {
  const fileRef = useRef<HTMLInputElement>(null);

  // Proof state
  const [proofData, setProofData] = useState<ProofData | null>(null);
  const [fileName, setFileName] = useState("");
  const [dragging, setDragging] = useState(false);

  // Wallet state
  const [address, setAddress] = useState<string | null>(null);
  const [showWalletModal, setShowWalletModal] = useState(false);
  const [wallets, setWallets] = useState<DetectedWallet[]>([]);
  const [connecting, setConnecting] = useState<string | null>(null);

  // Check / submit state
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);
  const [checkResult, setCheckResult] = useState<CheckResult | null>(null);
  const [checkedAddr, setCheckedAddr] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  useEffect(() => {
    if (showWalletModal) setWallets(detectWallets());
  }, [showWalletModal]);

  // ── File handling ───────────────────────────────────────────────────────────
  const handleFile = useCallback(async (file: File) => {
    try {
      const data = JSON.parse(await file.text()) as ProofData;
      if (!data.proof || !data.publicSignals) throw new Error("Missing proof or publicSignals");
      setProofData(data);
      setFileName(file.name);
      setStep("idle");
      setError(null);
      setCheckResult(null);
      setTxHash(null);
    } catch (e: any) {
      setError("Invalid proof file: " + e.message);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  }, [handleFile]);

  // ── Wallet connection ───────────────────────────────────────────────────────
  const connectWallet = useCallback(async (wallet: DetectedWallet) => {
    setConnecting(wallet.id);
    try {
      const provider = wallet.provider();
      if (!provider) throw new Error(`${wallet.name} not detected`);
      const accounts = await provider.request({ method: "eth_requestAccounts" });
      if (!accounts?.length) throw new Error("No accounts returned");
      setAddress(accounts[0]);
      setShowWalletModal(false);
    } catch (e: any) {
      setError(e.message || "Connection failed");
    } finally {
      setConnecting(null);
    }
  }, []);

  const disconnect = () => {
    setAddress(null);
    setStep("idle");
    setCheckResult(null);
    setCheckedAddr(null);
    setTxHash(null);
    setError(null);
  };

  // ── Check attestation — mirrors verify-pan.ts checks [1][2][3] ─────────────
  const handleCheck = useCallback(async (addr: string) => {
    setStep("checking");
    setError(null);
    setCheckedAddr(addr);
    try {
      const client = getPublicClient();
      const a = addr as `0x${string}`;

      const [hasAttestation, isValid, nullifier] = await Promise.all([
        client.readContract({
          address: PAN_ATTESTER_ADDRESS, abi: PAN_ATTESTER_ABI,
          functionName: "hasValidAttestation", args: [a],
        }) as Promise<boolean>,
        client.readContract({
          address: ATTESTATION_REGISTRY, abi: REGISTRY_ABI,
          functionName: "isValid", args: [a, SCHEMA, PAN_ATTESTER_ADDRESS],
        }) as Promise<boolean>,
        client.readContract({
          address: PAN_ATTESTER_ADDRESS, abi: PAN_ATTESTER_ABI,
          functionName: "getNullifierByAddress", args: [a],
        }) as Promise<bigint>,
      ]);

      setCheckResult({ hasAttestation, isValid, nullifier });
      setStep("done");
    } catch (e: any) {
      setError(
        e.message?.includes("fetch")
          ? `Cannot connect to Paseo. Check network.`
          : e.message || "Check failed"
      );
      setStep("error");
    }
  }, []);

  // ── Submit proof on-chain — mirrors verify-pan.ts PROOF_FILE flow ──────────
  const handleSubmit = useCallback(async () => {
    if (!proofData || !address) return;
    setStep("submitting");
    setError(null);
    try {
      const publicClient = getPublicClient();
      const proofNullifier = BigInt(proofData.publicSignals[1]);

      // Check nullifier not already used
      const nullifierUsed = await publicClient.readContract({
        address: PAN_ATTESTER_ADDRESS, abi: PAN_ATTESTER_ABI,
        functionName: "isNullifierUsed", args: [proofNullifier],
      }) as boolean;

      if (nullifierUsed) {
        setError("⚠️ Nullifier already used — this PAN was already attested");
        setStep("error");
        return;
      }

      const eth = (window as any).ethereum;
      if (!eth) throw new Error("No EVM wallet found. Connect MetaMask or Talisman EVM mode.");

      const walletClient = createWalletClient({
        transport: custom(eth),
        chain: paseoAssetHub as any,
      });

      const hash = await walletClient.writeContract({
        address: PAN_ATTESTER_ADDRESS,
        abi: PAN_ATTESTER_ABI,
        functionName: "verifyAndAttest",
        args: [
          proofNullifier,
          BigInt(proofData.publicSignals[2]),
          BigInt(proofData.publicSignals[3]),
          1n,
          packGroth16Proof(proofData.proof),
        ],
        account: address as `0x${string}`,
        chain: paseoAssetHub as any,
      });

      setTxHash(hash);
      await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });

      // Re-run all 3 checks after submission
      await handleCheck(address);
    } catch (e: any) {
      setError(e.message || "Transaction failed");
      setStep("error");
    }
  }, [proofData, address, handleCheck]);

  const pub = proofData?.publicSignals;
  const shortAddr = address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "";
  const isChecked = checkResult && step !== "checking" && step !== "submitting";

  return (
    <>
      <style>{CSS}</style>

      {/* ── Wallet modal ──────────────────────────────────────────────────── */}
      {showWalletModal && (
        <div className="vfy-modal-backdrop" onClick={() => setShowWalletModal(false)}>
          <div className="vfy-modal" onClick={(e) => e.stopPropagation()}>
            <div className="vfy-modal-header">
              <span className="vfy-modal-title">Connect Wallet</span>
              <button className="vfy-modal-close" onClick={() => setShowWalletModal(false)}>✕</button>
            </div>
            <p className="vfy-modal-sub">Select a wallet to check and submit attestations</p>
            <div className="vfy-wallet-list">
              {wallets.length === 0 && (
                <div className="vfy-no-wallet">
                  No EVM wallet detected.<br />
                  Install <a href="https://metamask.io" target="_blank" rel="noreferrer">MetaMask</a> or{" "}
                  <a href="https://talisman.xyz" target="_blank" rel="noreferrer">Talisman</a>.
                </div>
              )}
              {wallets.map((w) => (
                <button
                  key={w.id}
                  className={`vfy-wallet-btn${!w.installed ? " vfy-wallet-disabled" : ""}`}
                  onClick={() => w.installed && connectWallet(w)}
                  disabled={!w.installed || connecting === w.id}
                >
                  <span className="vfy-wallet-icon">{w.icon}</span>
                  <span className="vfy-wallet-name">{w.name}</span>
                  {!w.installed && <span className="vfy-badge">Not installed</span>}
                  {connecting === w.id && <span className="vfy-badge">Connecting…</span>}
                  {w.installed && connecting !== w.id && <span className="vfy-wallet-arrow">→</span>}
                </button>
              ))}
            </div>
            <p className="vfy-modal-note">Paseo Asset Hub · Chain ID 420420417</p>
          </div>
        </div>
      )}

      <div className="vfy-root">
        <div className="vfy-noise" />

        {/* ── Nav ───────────────────────────────────────────────────────── */}
        <nav className="vfy-nav">
          <a href="/" className="vfy-logo">
            <span className="vfy-logo-dot" />
            <span>ZK PAN</span>
          </a>
          <div className="vfy-nav-links">
            <a href="#/generate" className="vfy-nav-link">Generate</a>
            <a href="#/verify" className="vfy-nav-link vfy-nav-active">Verify</a>
            <a href="#/event" className="vfy-nav-link">India Summit</a>
          </div>
          {!address ? (
            <button className="vfy-connect-btn" onClick={() => setShowWalletModal(true)}>
              Connect Wallet
            </button>
          ) : (
            <div className="vfy-wallet-pill">
              <span className="vfy-status-dot" />
              <span className="vfy-addr-text">{shortAddr}</span>
              <button className="vfy-disconnect-btn" onClick={disconnect}>Disconnect</button>
            </div>
          )}
        </nav>

        {/* ── Hero ──────────────────────────────────────────────────────── */}
        <section className="vfy-hero">
          <div className="vfy-hero-tag">
            <span className="vfy-tag-dot" />
            On-chain Attestation
          </div>
          <h1 className="vfy-hero-title">Verify Proof</h1>
          <p className="vfy-hero-sub">
            Upload your ZK proof JSON, check it against PANAttester and
            AttestationRegistry on Paseo, then submit on-chain to receive an attestation.
          </p>
        </section>

        {/* ── Main layout ───────────────────────────────────────────────── */}
        <div className="vfy-layout">

          {/* ── Left column ─────────────────────────────────────────────── */}
          <div className="vfy-left">

            {/* File upload / loaded */}
            {!proofData ? (
              <div
                className={`vfy-dropzone${dragging ? " vfy-dragging" : ""}`}
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileRef.current?.click()}
              >
                <input ref={fileRef} type="file" accept=".json" className="vfy-file-input"
                  onChange={(e) => { if (e.target.files?.[0]) handleFile(e.target.files[0]); }} />
                <div className="vfy-dz-icon">
                  <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                    <path d="M14 4v16M6 12l8-8 8 8" stroke="currentColor" strokeWidth="2"
                      strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M4 22v1a1 1 0 001 1h18a1 1 0 001-1v-1" stroke="currentColor"
                      strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </div>
                <p className="vfy-dz-title">Upload proof JSON</p>
                <p className="vfy-dz-hint">zk-pan-proof.json from the Generate page</p>
              </div>
            ) : (
              <div className="vfy-file-loaded">
                <div className="vfy-file-info">
                  <div className="vfy-file-icon">
                    <svg width="17" height="17" viewBox="0 0 18 18" fill="none">
                      <path d="M4 2h7l4 4v10a1 1 0 01-1 1H5a1 1 0 01-1-1V3a1 1 0 011-1z"
                        stroke="currentColor" strokeWidth="1.5" />
                      <path d="M11 2v4h4" stroke="currentColor" strokeWidth="1.5" />
                    </svg>
                  </div>
                  <div>
                    <div className="vfy-file-name">{fileName}</div>
                    <div className="vfy-file-meta">{pub?.length} public signals</div>
                  </div>
                </div>
                <button className="vfy-change-btn" onClick={() => {
                  setProofData(null); setStep("idle");
                  setCheckResult(null); setError(null);
                }}>
                  Change
                </button>
              </div>
            )}

            {/* Public signals */}
            {pub && (
              <div className="vfy-signals-card">
                <div className="vfy-card-title">Public Signals</div>
                {[
                  { label: "Pubkey Hash", value: pub[0]?.slice(0, 18) + "…" },
                  { label: "Nullifier", value: pub[1]?.slice(0, 18) + "…" },
                  { label: "Document Type", value: pub[2] },
                  { label: "Revealed Data", value: decodePackedBytes(pub[3] || "0") },
                  { label: "Nullifier Seed", value: pub[4] },
                ].map(({ label, value }) => (
                  <div key={label} className="vfy-signal-row">
                    <span className="vfy-signal-label">{label}</span>
                    <span className="vfy-signal-value">{value}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Contract info */}
            {proofData && (
              <div className="vfy-contract-card">
                <div className="vfy-card-title">Checking against</div>
                {[
                  { label: "PANAttester", value: `${PAN_ATTESTER_ADDRESS.slice(0, 10)}…${PAN_ATTESTER_ADDRESS.slice(-6)}` },
                  { label: "AttestationRegistry", value: `${ATTESTATION_REGISTRY.slice(0, 10)}…${ATTESTATION_REGISTRY.slice(-6)}` },
                  { label: "Network", value: "Paseo Asset Hub" },
                  { label: "RPC", value: "testnet-passet-hub-eth-rpc.polkadot.io" },
                ].map(({ label, value }) => (
                  <div key={label} className="vfy-contract-row">
                    <span>{label}</span>
                    <code>{value}</code>
                  </div>
                ))}
              </div>
            )}

            {/* Check action */}
            {proofData && step === "idle" && (
              <div className="vfy-check-actions">
                {address ? (
                  <button className="vfy-check-btn" onClick={() => handleCheck(address)}>
                    <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                      <path d="M8 1L1.5 4v5c0 3.87 2.76 7.49 6.5 8.5C11.74 16.49 14.5 12.87 14.5 9V4L8 1z"
                        stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                    </svg>
                    Check Attestation
                    <span className="vfy-check-addr">{address.slice(0, 8)}…</span>
                  </button>
                ) : (
                  <div className="vfy-connect-prompt">
                    <span>Connect wallet to check attestation</span>
                    <button className="vfy-connect-btn-sm" onClick={() => setShowWalletModal(true)}>
                      Connect →
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="vfy-error-box">
                <strong>Error:</strong> {error}
              </div>
            )}
          </div>

          {/* ── Right column ────────────────────────────────────────────── */}
          <div className="vfy-right">

            {/* Loading */}
            {(step === "checking" || step === "submitting") && (
              <div className="vfy-loading-card">
                <div className="vfy-spinner" />
                <div>
                  <p className="vfy-loading-title">
                    {step === "checking" ? "Running 3 checks on Paseo…" : "Submitting to Paseo…"}
                  </p>
                  {step === "checking" && checkedAddr && (
                    <p className="vfy-loading-addr">
                      {checkedAddr.slice(0, 14)}…{checkedAddr.slice(-6)}
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Result */}
            {isChecked && (
              <div className={`vfy-result-card${checkResult!.isValid ? " vfy-result-success" : " vfy-result-fail"}`}>

                {/* Verdict */}
                <div className="vfy-verdict">
                  {checkResult!.isValid ? (
                    <div className="vfy-verdict-icon vfy-verdict-pass">
                      <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                        <path d="M7 14l5 5 9-10" stroke="currentColor" strokeWidth="2.5"
                          strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                  ) : (
                    <div className="vfy-verdict-icon vfy-verdict-fail-icon">
                      <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                        <path d="M14 8v8M14 19v1" stroke="currentColor" strokeWidth="2.5"
                          strokeLinecap="round" />
                      </svg>
                    </div>
                  )}
                  <h2 className="vfy-verdict-title">
                    {checkResult!.isValid ? "Attestation Valid" : "No Attestation Found"}
                  </h2>
                  <p className="vfy-verdict-addr">
                    {checkedAddr?.slice(0, 10)}…{checkedAddr?.slice(-8)}
                  </p>
                </div>

                {/* 3 checks mirroring verify-pan.ts */}
                <div className="vfy-checks">
                  {[
                    {
                      name: "[1] PANAttester.hasValidAttestation()",
                      pass: checkResult!.hasAttestation,
                      result: String(checkResult!.hasAttestation),
                    },
                    {
                      name: "[2] AttestationRegistry.isValid()",
                      pass: checkResult!.isValid,
                      result: checkResult!.isValid ? "true — registry confirms" : "false — not in registry",
                    },
                    {
                      name: "[3] getNullifierByAddress()",
                      pass: checkResult!.nullifier > 0n,
                      result: checkResult!.nullifier > 0n
                        ? checkResult!.nullifier.toString().slice(0, 16) + "…"
                        : "No nullifier",
                    },
                  ].map(({ name, pass, result }) => (
                    <div key={name} className="vfy-check-row">
                      <div className={`vfy-check-icon${pass ? " vfy-pass" : " vfy-fail-icon-sm"}`}>
                        {pass ? "✓" : "✗"}
                      </div>
                      <div className="vfy-check-info">
                        <span className="vfy-check-name">{name}</span>
                        <span className="vfy-check-result">{result}</span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Verified attributes */}
                {checkResult!.isValid && (
                  <div className="vfy-attrs">
                    {[
                      "Valid PAN card holder",
                      "Signed by National e-Governance Division",
                      `PAN: ${decodePackedBytes(pub?.[3] || "0")}`,
                      "Sybil-resistant nullifier",
                    ].map((a) => (
                      <div key={a} className="vfy-attr">
                        <svg width="14" height="14" viewBox="0 0 15 15" fill="none">
                          <circle cx="7.5" cy="7.5" r="6.5" fill="currentColor" fillOpacity="0.12" />
                          <path d="M4.5 7.5l2.5 2.5 4-4" stroke="currentColor" strokeWidth="1.4"
                            strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        {a}
                      </div>
                    ))}
                  </div>
                )}

                {/* TX hash */}
                {txHash && (
                  <div className="vfy-tx-row">
                    <span>TX Hash</span>
                    <code>{txHash.slice(0, 18)}…{txHash.slice(-8)}</code>
                  </div>
                )}

                {/* Submit section — shown only when not yet attested */}
                {!checkResult!.isValid && proofData && (
                  <div className="vfy-submit-section">
                    <p className="vfy-submit-desc">
                      Submit your proof on-chain to PANAttester and receive an attestation
                      via Protocol Commons AttestationRegistry.
                    </p>
                    {!address ? (
                      <div className="vfy-connect-prompt">
                        <span>Connect wallet to submit</span>
                        <button className="vfy-connect-btn-sm" onClick={() => setShowWalletModal(true)}>
                          Connect →
                        </button>
                      </div>
                    ) : (
                      <button
                        className="vfy-submit-btn"
                        onClick={handleSubmit}
                        disabled={step !== "idle"}
                      >
                        {step !== "idle" ? (
                          <><div className="vfy-submit-spinner" /> Submitting to Paseo…</>
                        ) : (
                          <>
                            <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                              <path d="M8 1L1.5 4v5c0 3.87 2.76 7.49 6.5 8.5C11.74 16.49 14.5 12.87 14.5 9V4L8 1z"
                                stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                            </svg>
                            Submit Proof On-Chain
                          </>
                        )}
                      </button>
                    )}
                  </div>
                )}

                <button className="vfy-reset-btn" onClick={() => setStep("idle")}>
                  Check another address
                </button>
              </div>
            )}

            {/* Placeholder */}
            {step === "idle" && (
              <div className="vfy-placeholder">
                <div className="vfy-placeholder-icon">◈</div>
                <p>
                  {!proofData
                    ? "Upload a proof file to get started"
                    : !address
                    ? "Connect wallet and click Check Attestation"
                    : "Click Check Attestation"}
                </p>
                {!proofData && (
                  <a href="/generate" className="vfy-placeholder-link">
                    Generate a proof first →
                  </a>
                )}
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
    --vfy-bg: #08090a;
    --vfy-surface: #111215;
    --vfy-surface2: #18191e;
    --vfy-border: rgba(255,255,255,0.07);
    --vfy-border-bright: rgba(255,255,255,0.13);
    --vfy-ink: #f0ede8;
    --vfy-muted: #6b6f7a;
    --vfy-pink: #e6007a;
    --vfy-pink-dim: rgba(230,0,122,0.1);
    --vfy-green: #56f39a;
    --vfy-green-dim: rgba(86,243,154,0.08);
    --vfy-amber: #f0a500;
    --vfy-red: #f87171;
    --vfy-red-dim: rgba(239,68,68,0.08);
    --vfy-radius: 12px;
    --vfy-radius-lg: 20px;
    --vfy-mono: 'DM Mono', monospace;
    --vfy-display: 'Syne', sans-serif;
    --vfy-body: 'DM Sans', sans-serif;
    --vfy-t: 0.18s ease;
  }

  .vfy-root {
    min-height: 100vh;
    background: var(--vfy-bg);
    color: var(--vfy-ink);
    font-family: var(--vfy-body);
    position: relative;
    overflow-x: hidden;
  }

  .vfy-noise {
    pointer-events: none;
    position: fixed; inset: 0; z-index: 0; opacity: 0.025;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
    background-size: 200px;
  }

  /* Nav */
  .vfy-nav {
    position: sticky; top: 0; z-index: 50;
    display: flex; align-items: center; justify-content: space-between;
    padding: 1.25rem 2.5rem;
    background: rgba(8,9,10,0.88); backdrop-filter: blur(16px);
    border-bottom: 1px solid var(--vfy-border);
  }
  .vfy-logo {
    display: flex; align-items: center; gap: 0.625rem;
    text-decoration: none; font-family: var(--vfy-display);
    font-weight: 800; font-size: 1rem; color: var(--vfy-ink);
  }
  .vfy-logo-dot {
    width: 8px; height: 8px; border-radius: 50%;
    background: var(--vfy-pink); box-shadow: 0 0 8px var(--vfy-pink);
    animation: vfy-pulse 2s ease-in-out infinite;
  }
  @keyframes vfy-pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.5;transform:scale(0.8)} }
  .vfy-nav-links { display: flex; gap: 2rem; align-items: center; }
  .vfy-nav-link {
    font-size: 0.875rem; font-weight: 500;
    color: var(--vfy-muted); text-decoration: none;
    transition: color var(--vfy-t);
  }
  .vfy-nav-link:hover, .vfy-nav-active { color: var(--vfy-ink); }
  .vfy-nav-active { position: relative; }
  .vfy-nav-active::after {
    content: ''; position: absolute; bottom: -4px; left: 0; right: 0;
    height: 2px; border-radius: 1px; background: var(--vfy-pink);
  }
  .vfy-wallet-pill {
    display: flex; align-items: center; gap: 0.625rem;
    background: var(--vfy-surface2); border: 1px solid var(--vfy-border-bright);
    border-radius: 100px; padding: 0.4rem 0.875rem; font-size: 0.85rem;
  }
  .vfy-status-dot {
    width: 7px; height: 7px; border-radius: 50%;
    background: var(--vfy-green); box-shadow: 0 0 6px var(--vfy-green);
  }
  .vfy-addr-text { font-family: var(--vfy-mono); font-size: 0.78rem; color: var(--vfy-ink); }
  .vfy-disconnect-btn {
    background: none; border: none; color: var(--vfy-muted);
    font-size: 0.75rem; cursor: pointer; font-family: var(--vfy-body);
    transition: color var(--vfy-t); padding: 0;
  }
  .vfy-disconnect-btn:hover { color: var(--vfy-ink); }
  .vfy-connect-btn {
    background: var(--vfy-pink); color: #fff; border: none;
    border-radius: 100px; padding: 0.6rem 1.5rem;
    font-size: 0.875rem; font-weight: 500; cursor: pointer;
    font-family: var(--vfy-body); transition: all var(--vfy-t);
    box-shadow: 0 0 20px rgba(230,0,122,0.3);
  }
  .vfy-connect-btn:hover { background: #ff2d8e; transform: translateY(-1px); }

  /* Hero */
  .vfy-hero {
    padding: 4rem 2.5rem 2rem; max-width: 720px;
    animation: vfy-fade-up 0.5s ease both;
  }
  .vfy-hero-tag {
    display: inline-flex; align-items: center; gap: 0.5rem;
    font-family: var(--vfy-mono); font-size: 0.72rem; font-weight: 500;
    color: var(--vfy-pink); background: var(--vfy-pink-dim);
    border: 1px solid rgba(230,0,122,0.2); border-radius: 100px;
    padding: 0.3rem 0.875rem; margin-bottom: 1.25rem; letter-spacing: 0.06em;
  }
  .vfy-tag-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--vfy-pink); }
  .vfy-hero-title {
    font-family: var(--vfy-display); font-weight: 800;
    font-size: clamp(2.5rem, 5vw, 4rem); letter-spacing: -0.03em;
    color: var(--vfy-ink); margin-bottom: 0.75rem; line-height: 1.05;
  }
  .vfy-hero-sub { font-size: 1rem; line-height: 1.7; color: var(--vfy-muted); max-width: 480px; }

  /* Layout */
  .vfy-layout {
    display: grid; grid-template-columns: 1fr 1fr;
    gap: 2rem; align-items: start;
    padding: 2rem 2.5rem 5rem; max-width: 1200px;
  }
  @media (max-width: 820px) { .vfy-layout { grid-template-columns: 1fr; } }

  /* Dropzone */
  .vfy-dropzone {
    border: 2px dashed rgba(255,255,255,0.12);
    border-radius: var(--vfy-radius-lg); padding: 3.5rem 2rem;
    text-align: center; cursor: pointer;
    transition: all var(--vfy-t); background: var(--vfy-surface);
    animation: vfy-fade-up 0.5s 0.1s ease both;
  }
  .vfy-dropzone:hover, .vfy-dragging { border-color: var(--vfy-pink); background: var(--vfy-pink-dim); }
  .vfy-file-input { display: none; }
  .vfy-dz-icon {
    width: 56px; height: 56px; border-radius: 50%;
    background: var(--vfy-surface2); color: var(--vfy-muted);
    display: flex; align-items: center; justify-content: center;
    margin: 0 auto 1rem; transition: all var(--vfy-t);
  }
  .vfy-dropzone:hover .vfy-dz-icon { background: var(--vfy-pink-dim); color: var(--vfy-pink); }
  .vfy-dz-title {
    font-family: var(--vfy-display); font-size: 1rem; font-weight: 700;
    color: var(--vfy-ink); margin-bottom: 0.3rem;
  }
  .vfy-dz-hint { font-size: 0.85rem; color: var(--vfy-muted); }

  /* File loaded */
  .vfy-file-loaded {
    display: flex; align-items: center; justify-content: space-between; gap: 1rem;
    background: var(--vfy-surface); border: 1px solid var(--vfy-border-bright);
    border-radius: var(--vfy-radius-lg); padding: 1rem 1.25rem;
  }
  .vfy-file-info { display: flex; align-items: center; gap: 0.75rem; }
  .vfy-file-icon {
    width: 36px; height: 36px; background: var(--vfy-pink-dim);
    border-radius: var(--vfy-radius); display: flex; align-items: center;
    justify-content: center; color: var(--vfy-pink); flex-shrink: 0;
  }
  .vfy-file-name { font-weight: 500; font-size: 0.9rem; color: var(--vfy-ink); }
  .vfy-file-meta { font-size: 0.78rem; color: var(--vfy-muted); margin-top: 0.1rem; }
  .vfy-change-btn {
    font-size: 0.78rem; color: var(--vfy-muted); background: none;
    border: 1px solid var(--vfy-border); border-radius: 100px;
    padding: 0.3rem 0.75rem; cursor: pointer;
    font-family: var(--vfy-body); transition: all var(--vfy-t);
  }
  .vfy-change-btn:hover { color: var(--vfy-ink); border-color: var(--vfy-border-bright); }

  /* Signals + contract cards */
  .vfy-signals-card, .vfy-contract-card {
    background: var(--vfy-surface); border: 1px solid var(--vfy-border);
    border-radius: var(--vfy-radius-lg); overflow: hidden; margin-top: 1rem;
  }
  .vfy-card-title {
    padding: 0.75rem 1.25rem; font-size: 0.68rem; font-weight: 700;
    letter-spacing: 0.1em; text-transform: uppercase; color: var(--vfy-muted);
    border-bottom: 1px solid var(--vfy-border); background: var(--vfy-surface2);
    font-family: var(--vfy-mono);
  }
  .vfy-signal-row, .vfy-contract-row {
    display: flex; align-items: center; justify-content: space-between;
    padding: 0.6rem 1.25rem; border-bottom: 1px solid var(--vfy-border);
  }
  .vfy-signal-row:last-child, .vfy-contract-row:last-child { border-bottom: none; }
  .vfy-signal-label, .vfy-contract-row span { font-size: 0.78rem; color: var(--vfy-muted); }
  .vfy-signal-value, .vfy-contract-row code {
    font-family: var(--vfy-mono); font-size: 0.75rem; color: var(--vfy-ink); font-weight: 500;
  }

  /* Check actions */
  .vfy-check-actions { margin-top: 1rem; }
  .vfy-check-btn {
    width: 100%; display: flex; align-items: center; justify-content: center; gap: 0.625rem;
    background: var(--vfy-pink); color: #fff; border: none;
    border-radius: var(--vfy-radius-lg); padding: 1rem;
    font-size: 0.9rem; font-weight: 600; cursor: pointer;
    font-family: var(--vfy-body); transition: all var(--vfy-t);
    box-shadow: 0 0 20px rgba(230,0,122,0.25);
  }
  .vfy-check-btn:hover { background: #ff2d8e; transform: translateY(-1px); box-shadow: 0 0 32px rgba(230,0,122,0.45); }
  .vfy-check-addr { font-family: var(--vfy-mono); font-size: 0.75rem; opacity: 0.65; }
  .vfy-connect-prompt {
    display: flex; align-items: center; justify-content: space-between;
    padding: 0.875rem 1rem; background: var(--vfy-surface2);
    border: 1px solid var(--vfy-border); border-radius: var(--vfy-radius-lg);
    font-size: 0.85rem; color: var(--vfy-muted);
  }
  .vfy-connect-btn-sm {
    background: none; border: 1px solid var(--vfy-border-bright);
    border-radius: 100px; color: var(--vfy-ink); font-family: var(--vfy-body);
    font-size: 0.8rem; padding: 0.3rem 0.875rem; cursor: pointer;
    transition: all var(--vfy-t);
  }
  .vfy-connect-btn-sm:hover { background: var(--vfy-surface); border-color: var(--vfy-pink); color: var(--vfy-pink); }

  /* Error */
  .vfy-error-box {
    background: var(--vfy-red-dim); border: 1px solid rgba(239,68,68,0.25);
    border-radius: var(--vfy-radius); padding: 0.875rem;
    font-size: 0.85rem; color: var(--vfy-red); margin-top: 1rem;
  }

  /* Loading */
  .vfy-loading-card {
    display: flex; align-items: center; gap: 1rem; padding: 1.75rem;
    background: var(--vfy-surface); border: 1px solid var(--vfy-border);
    border-radius: var(--vfy-radius-lg);
    animation: vfy-fade-up 0.3s ease both;
  }
  .vfy-spinner {
    width: 28px; height: 28px; flex-shrink: 0;
    border: 3px solid var(--vfy-border-bright);
    border-top-color: var(--vfy-pink); border-radius: 50%;
    animation: vfy-spin 0.75s linear infinite;
  }
  @keyframes vfy-spin { to { transform: rotate(360deg); } }
  .vfy-loading-title { font-size: 0.9rem; color: var(--vfy-ink); }
  .vfy-loading-addr { font-family: var(--vfy-mono); font-size: 0.78rem; color: var(--vfy-muted); margin-top: 0.25rem; }

  /* Result card */
  .vfy-result-card {
    background: var(--vfy-surface); border: 1px solid var(--vfy-border);
    border-radius: var(--vfy-radius-lg); overflow: hidden;
    animation: vfy-fade-up 0.4s ease both;
  }
  .vfy-result-success { border-color: rgba(86,243,154,0.25); }
  .vfy-result-fail { border-color: rgba(240,165,0,0.2); }

  .vfy-verdict {
    display: flex; flex-direction: column; align-items: center;
    padding: 2rem 1.5rem 1.5rem; text-align: center;
    border-bottom: 1px solid var(--vfy-border);
  }
  .vfy-verdict-icon {
    width: 60px; height: 60px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center; margin-bottom: 1rem;
  }
  .vfy-verdict-pass { background: rgba(86,243,154,0.12); color: var(--vfy-green); }
  .vfy-verdict-fail-icon { background: rgba(240,165,0,0.1); color: var(--vfy-amber); }
  .vfy-verdict-title {
    font-family: var(--vfy-display); font-size: 1.5rem; font-weight: 800;
    color: var(--vfy-ink); margin-bottom: 0.25rem;
  }
  .vfy-verdict-addr { font-family: var(--vfy-mono); font-size: 0.75rem; color: var(--vfy-muted); }

  .vfy-checks { padding: 0.5rem 0; border-bottom: 1px solid var(--vfy-border); }
  .vfy-check-row {
    display: flex; align-items: flex-start; gap: 0.75rem;
    padding: 0.75rem 1.5rem; border-bottom: 1px solid var(--vfy-border);
  }
  .vfy-check-row:last-child { border-bottom: none; }
  .vfy-check-icon {
    width: 22px; height: 22px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    font-size: 0.72rem; font-weight: 700; flex-shrink: 0; margin-top: 2px;
  }
  .vfy-pass { background: var(--vfy-green); color: #08090a; }
  .vfy-fail-icon-sm { background: rgba(240,165,0,0.15); color: var(--vfy-amber); }
  .vfy-check-info { display: flex; flex-direction: column; gap: 0.2rem; }
  .vfy-check-name { font-family: var(--vfy-mono); font-size: 0.75rem; color: var(--vfy-ink); font-weight: 500; }
  .vfy-check-result { font-size: 0.78rem; color: var(--vfy-muted); }

  .vfy-attrs {
    display: flex; flex-direction: column; gap: 0.5rem;
    padding: 1rem 1.5rem; border-bottom: 1px solid var(--vfy-border);
  }
  .vfy-attr {
    display: flex; align-items: center; gap: 0.5rem;
    font-size: 0.85rem; color: var(--vfy-green);
  }

  .vfy-tx-row {
    display: flex; align-items: center; justify-content: space-between;
    padding: 0.75rem 1.5rem;
    background: rgba(86,243,154,0.06);
    border-bottom: 1px solid var(--vfy-border);
  }
  .vfy-tx-row span { font-size: 0.75rem; color: var(--vfy-green); font-weight: 600; }
  .vfy-tx-row code { font-family: var(--vfy-mono); font-size: 0.72rem; color: var(--vfy-green); }

  .vfy-submit-section {
    padding: 1.25rem 1.5rem; border-bottom: 1px solid var(--vfy-border);
    background: rgba(255,255,255,0.02);
  }
  .vfy-submit-desc { font-size: 0.82rem; color: var(--vfy-muted); line-height: 1.6; margin-bottom: 0.875rem; }
  .vfy-submit-btn {
    width: 100%; display: flex; align-items: center; justify-content: center; gap: 0.5rem;
    background: #1a4a8a; color: white; border: none;
    border-radius: var(--vfy-radius); padding: 0.875rem;
    font-size: 0.9rem; font-weight: 600; cursor: pointer;
    font-family: var(--vfy-body); transition: all var(--vfy-t);
  }
  .vfy-submit-btn:hover:not(:disabled) { background: #0f3266; transform: translateY(-1px); }
  .vfy-submit-btn:disabled { opacity: 0.6; cursor: wait; }
  .vfy-submit-spinner {
    width: 15px; height: 15px;
    border: 2px solid rgba(255,255,255,0.3); border-top-color: white;
    border-radius: 50%; animation: vfy-spin 0.7s linear infinite;
  }

  .vfy-reset-btn {
    width: 100%; padding: 0.875rem; background: none; border: none;
    font-size: 0.85rem; color: var(--vfy-muted); cursor: pointer;
    font-family: var(--vfy-body); transition: color var(--vfy-t);
  }
  .vfy-reset-btn:hover { color: var(--vfy-ink); }

  .vfy-placeholder {
    display: flex; flex-direction: column; align-items: center;
    justify-content: center; gap: 0.875rem; min-height: 300px;
    border: 1px dashed var(--vfy-border); border-radius: var(--vfy-radius-lg);
  }
  .vfy-placeholder-icon { font-size: 2.5rem; opacity: 0.2; color: var(--vfy-muted); }
  .vfy-placeholder p { font-size: 0.9rem; color: var(--vfy-muted); text-align: center; padding: 0 1rem; }
  .vfy-placeholder-link { font-size: 0.85rem; color: var(--vfy-pink); text-decoration: none; }
  .vfy-placeholder-link:hover { text-decoration: underline; }

  /* Modal */
  .vfy-modal-backdrop {
    position: fixed; inset: 0; z-index: 200;
    background: rgba(0,0,0,0.75); backdrop-filter: blur(8px);
    display: flex; align-items: center; justify-content: center; padding: 1rem;
  }
  .vfy-modal {
    background: var(--vfy-surface); border: 1px solid var(--vfy-border-bright);
    border-radius: var(--vfy-radius-lg); padding: 2rem; width: 100%; max-width: 400px;
    animation: vfy-fade-up 0.25s ease both;
  }
  .vfy-modal-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.5rem; }
  .vfy-modal-title { font-family: var(--vfy-display); font-size: 1.25rem; font-weight: 800; color: var(--vfy-ink); }
  .vfy-modal-close {
    background: none; border: none; color: var(--vfy-muted); font-size: 1rem;
    cursor: pointer; transition: color var(--vfy-t); padding: 0.25rem;
  }
  .vfy-modal-close:hover { color: var(--vfy-ink); }
  .vfy-modal-sub { font-size: 0.85rem; color: var(--vfy-muted); margin-bottom: 1.5rem; }
  .vfy-wallet-list { display: flex; flex-direction: column; gap: 0.625rem; margin-bottom: 1.25rem; }
  .vfy-wallet-btn {
    display: flex; align-items: center; gap: 0.875rem;
    background: var(--vfy-surface2); border: 1px solid var(--vfy-border);
    border-radius: var(--vfy-radius); padding: 0.875rem 1rem;
    cursor: pointer; transition: all var(--vfy-t); color: var(--vfy-ink);
    font-family: var(--vfy-body); font-size: 0.9rem;
  }
  .vfy-wallet-btn:hover:not(.vfy-wallet-disabled) { border-color: var(--vfy-border-bright); background: #1e1f24; }
  .vfy-wallet-disabled { opacity: 0.4; cursor: not-allowed; }
  .vfy-wallet-icon { font-size: 1.25rem; }
  .vfy-wallet-name { font-weight: 500; flex: 1; text-align: left; }
  .vfy-badge {
    font-size: 0.7rem; font-family: var(--vfy-mono); color: var(--vfy-muted);
    border: 1px solid var(--vfy-border); border-radius: 100px; padding: 0.15rem 0.5rem;
  }
  .vfy-wallet-arrow { color: var(--vfy-muted); font-size: 0.9rem; margin-left: auto; }
  .vfy-no-wallet {
    text-align: center; padding: 1.5rem; color: var(--vfy-muted);
    font-size: 0.875rem; line-height: 1.6;
  }
  .vfy-no-wallet a { color: var(--vfy-pink); text-decoration: none; }
  .vfy-modal-note { font-size: 0.72rem; font-family: var(--vfy-mono); color: var(--vfy-muted); text-align: center; }

  @keyframes vfy-fade-up {
    from { opacity: 0; transform: translateY(14px); }
    to { opacity: 1; transform: translateY(0); }
  }
`;