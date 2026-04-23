import { useState, useEffect, useCallback } from "react";
import { createPublicClient, http } from "viem";

// ── Chain + contract config ───────────────────────────────────────────────────

const PASEO_RPC = "https://services.polkadothub-rpc.com/testnet";
const PAN_ATTESTER = "0xadeeaa7a41ef851a1edc691b5e399305bdff77e4" as const;
const ATTESTATION_REGISTRY = "0x4d018c530e01bbc98b042a18a4d4090658bcd8f3" as const;
const SCHEMA = "0x1f70926f006bbe27dee4902c852a268b648b358bebc8eeb42e524004752ead18" as const;

const paseoAssetHub = {
  id: 420420417,
  name: "Polkadot Hub TestNet",
  nativeCurrency: { name: "Unit", symbol: "UNIT", decimals: 18 },
  rpcUrls: { default: { http: [PASEO_RPC] } },
} as const;

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
] as const;

// ── Types ─────────────────────────────────────────────────────────────────────

type CheckState = "idle" | "checking" | "verified" | "unverified" | "error";

interface AttestationRecord {
  issuedAt: number;
  expiry: number;
  nullifier: bigint;
}

interface Ticket {
  tier: string;
  original: number;
  discounted: number;
  perks: string[];
}

const TICKETS: Ticket[] = [
  {
    tier: "General",
    original: 4999,
    discounted: 2499,
    perks: ["All keynotes", "Networking dinner", "Swag bag"],
  },
  {
    tier: "Builder",
    original: 9999,
    discounted: 4999,
    perks: ["All General perks", "Hackathon access", "Workshop seats", "1:1 mentor session"],
  },
  {
    tier: "VIP",
    original: 24999,
    discounted: 12499,
    perks: ["All Builder perks", "Speaker dinner", "Front-row seating", "Recording access"],
  },
];

// ── Wallet detection ──────────────────────────────────────────────────────────

interface DetectedWallet {
  id: string;
  name: string;
  icon: string;
  provider: () => any;
  installed: boolean;
}

function detectWallets(): DetectedWallet[] {
  const eth = (window as any).ethereum;
  const wallets: DetectedWallet[] = [
    {
      id: "metamask",
      name: "MetaMask",
      icon: "🦊",
      provider: () => {
        if (eth?.providers) return eth.providers.find((p: any) => p.isMetaMask) ?? eth;
        return eth?.isMetaMask ? eth : null;
      },
      installed: !!(eth?.isMetaMask || eth?.providers?.some((p: any) => p.isMetaMask)),
    },
    {
      id: "talisman",
      name: "Talisman",
      icon: "🔮",
      provider: () => {
        if (eth?.providers) return eth.providers.find((p: any) => p.isTalisman) ?? null;
        return eth?.isTalisman ? eth : null;
      },
      installed: !!(eth?.isTalisman || eth?.providers?.some((p: any) => p.isTalisman)),
    },
    {
      id: "subwallet",
      name: "SubWallet",
      icon: "🪐",
      provider: () => {
        if (eth?.providers) return eth.providers.find((p: any) => p.isSubWallet) ?? null;
        return eth?.isSubWallet ? eth : null;
      },
      installed: !!(eth?.isSubWallet || eth?.providers?.some((p: any) => p.isSubWallet)),
    },
    {
      id: "injected",
      name: "Browser Wallet",
      icon: "🌐",
      provider: () => eth,
      installed: !!eth,
    },
  ];
  // deduplicate: if no specific wallet detected, only show generic
  const hasSpecific = wallets.slice(0, 3).some((w) => w.installed);
  if (hasSpecific) return wallets.filter((w) => w.id !== "injected" || !hasSpecific);
  return wallets.filter((w) => w.id === "injected");
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function IndiaEventPage() {
  const [address, setAddress] = useState<string | null>(null);
  const [checkState, setCheckState] = useState<CheckState>("idle");
  const [record, setRecord] = useState<AttestationRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [selectedTier, setSelectedTier] = useState<string | null>(null);
  const [wallets, setWallets] = useState<DetectedWallet[]>([]);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState({ days: 0, hours: 0, mins: 0, secs: 0 });

  // ── Countdown ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const target = new Date("2025-09-15T09:00:00+05:30").getTime();
    const tick = () => {
      const diff = target - Date.now();
      if (diff <= 0) return;
      setTimeLeft({
        days: Math.floor(diff / 86400000),
        hours: Math.floor((diff % 86400000) / 3600000),
        mins: Math.floor((diff % 3600000) / 60000),
        secs: Math.floor((diff % 60000) / 1000),
      });
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  // ── Detect wallets on modal open ────────────────────────────────────────────
  useEffect(() => {
    if (showModal) setWallets(detectWallets());
  }, [showModal]);

  // ── Attestation check ───────────────────────────────────────────────────────
  const checkAttestation = useCallback(async (addr: string) => {
    setCheckState("checking");
    setError(null);
    try {
      const client = createPublicClient({
        chain: paseoAssetHub as any,
        transport: http(PASEO_RPC),
      });

      const [hasValid, isValid] = await Promise.all([
        client.readContract({
          address: PAN_ATTESTER,
          abi: PAN_ATTESTER_ABI,
          functionName: "hasValidAttestation",
          args: [addr as `0x${string}`],
        }),
        client.readContract({
          address: ATTESTATION_REGISTRY,
          abi: REGISTRY_ABI,
          functionName: "isValid",
          args: [addr as `0x${string}`, SCHEMA, PAN_ATTESTER],
        }),
      ]);

      if (hasValid && isValid) {
        const [rec, nullifier] = await Promise.all([
          client.readContract({
            address: ATTESTATION_REGISTRY,
            abi: REGISTRY_ABI,
            functionName: "get",
            args: [addr as `0x${string}`, SCHEMA, PAN_ATTESTER],
          }),
          client.readContract({
            address: PAN_ATTESTER,
            abi: PAN_ATTESTER_ABI,
            functionName: "getNullifierByAddress",
            args: [addr as `0x${string}`],
          }),
        ]);
        setRecord({
          issuedAt: Number((rec as any).issuedAt),
          expiry: Number((rec as any).expiry),
          nullifier: nullifier as bigint,
        });
        setCheckState("verified");
      } else {
        setCheckState("unverified");
      }
    } catch (e: any) {
      setError(e.message?.includes("fetch") ? "Cannot reach Paseo. Check your network." : e.message || "Check failed");
      setCheckState("error");
    }
  }, []);

  // ── Connect wallet ──────────────────────────────────────────────────────────
  const connectWallet = useCallback(
    async (wallet: DetectedWallet) => {
      setConnecting(wallet.id);
      try {
        const provider = wallet.provider();
        if (!provider) throw new Error(`${wallet.name} not detected`);
        const accounts = await provider.request({ method: "eth_requestAccounts" });
        if (!accounts?.length) throw new Error("No accounts returned");
        const addr = accounts[0] as string;
        setAddress(addr);
        setShowModal(false);
        await checkAttestation(addr);
      } catch (e: any) {
        setError(e.message || "Connection failed");
      } finally {
        setConnecting(null);
      }
    },
    [checkAttestation]
  );

  const disconnect = () => {
    setAddress(null);
    setCheckState("idle");
    setRecord(null);
    setError(null);
  };

  const isVerified = checkState === "verified";
  const shortAddr = address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "";

  return (
    <>
      <style>{CSS}</style>

      {/* ── Wallet modal ──────────────────────────────────────────────────── */}
      {showModal && (
        <div className="modal-backdrop" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">Connect Wallet</span>
              <button className="modal-close" onClick={() => setShowModal(false)}>✕</button>
            </div>
            <p className="modal-sub">Choose your wallet to check PAN attestation</p>
            <div className="wallet-list">
              {wallets.length === 0 && (
                <div className="no-wallet">
                  No EVM wallet detected.<br />
                  Install <a href="https://metamask.io" target="_blank" rel="noreferrer">MetaMask</a> or{" "}
                  <a href="https://talisman.xyz" target="_blank" rel="noreferrer">Talisman</a>.
                </div>
              )}
              {wallets.map((w) => (
                <button
                  key={w.id}
                  className={`wallet-btn ${!w.installed ? "wallet-btn--disabled" : ""}`}
                  onClick={() => w.installed && connectWallet(w)}
                  disabled={!w.installed || connecting === w.id}
                >
                  <span className="wallet-icon">{w.icon}</span>
                  <span className="wallet-name">{w.name}</span>
                  {!w.installed && <span className="wallet-badge">Not installed</span>}
                  {connecting === w.id && <span className="wallet-badge">Connecting…</span>}
                  {w.installed && connecting !== w.id && <span className="wallet-arrow">→</span>}
                </button>
              ))}
            </div>
            <p className="modal-note">
              On Paseo Asset Hub · Chain ID 420420417
            </p>
          </div>
        </div>
      )}

      <div className="event-root">
        {/* ── Noise overlay ─────────────────────────────────────────────── */}
        <div className="noise" />

        {/* ── Nav ───────────────────────────────────────────────────────── */}
        <nav className="nav">
          <div className="nav-logo">
            <span className="nav-dot" />
            <span>Polkadot India Summit</span>
          </div>
          {!address ? (
            <button className="btn-connect" onClick={() => setShowModal(true)}>
              Connect Wallet
            </button>
          ) : (
            <div className="nav-wallet">
              <span className={`status-dot ${isVerified ? "status-dot--green" : "status-dot--amber"}`} />
              <span className="nav-addr">{shortAddr}</span>
              <button className="btn-disconnect" onClick={disconnect}>Disconnect</button>
            </div>
          )}
        </nav>

        {/* ── Hero ──────────────────────────────────────────────────────── */}
        <section className="hero">
          <div className="hero-eyebrow">
            <span className="pill">🇮🇳 Bengaluru, India</span>
            <span className="pill">September 15 – 17, 2026</span>
            <span className="pill pill--pink">ZK Identity × Polkadot</span>
          </div>
          <h1 className="hero-title">
            India's Biggest<br />
            <em>Web3 Summit</em>
          </h1>
          <p className="hero-sub">
            Three days of builders, founders, and researchers pushing the frontier of
            decentralised identity, cross-chain infra, and zero-knowledge proofs — in the
            heart of India's tech capital.
          </p>

          {/* Countdown */}
          <div className="countdown">
            {[
              { v: timeLeft.days, l: "Days" },
              { v: timeLeft.hours, l: "Hours" },
              { v: timeLeft.mins, l: "Mins" },
              { v: timeLeft.secs, l: "Secs" },
            ].map(({ v, l }) => (
              <div key={l} className="count-block">
                <span className="count-num">{String(v).padStart(2, "0")}</span>
                <span className="count-label">{l}</span>
              </div>
            ))}
          </div>
        </section>

        {/* ── Attestation status banner ──────────────────────────────────── */}
        {address && (
          <div className={`attest-banner attest-banner--${checkState}`}>
            {checkState === "checking" && (
              <div className="banner-inner">
                <span className="spinner" />
                <span>Checking your PAN attestation on Paseo…</span>
              </div>
            )}
            {checkState === "verified" && (
              <div className="banner-inner">
                <span className="check-icon">✓</span>
                <div>
                  <strong>Verified PAN Holder</strong>
                  <span className="banner-detail">
                    Attested on-chain
                  </span>
                </div>
                <span className="discount-tag">50% OFF</span>
              </div>
            )}
            {checkState === "unverified" && (
              <div className="banner-inner">
                <span className="x-icon">✗</span>
                <div>
                  <strong>No PAN attestation found</strong>
                  <span className="banner-detail">
                    Verify your PAN to unlock 50% discount on all ticket tiers
                  </span>
                </div>
                <a href="/generate" className="banner-cta">Get Verified →</a>
              </div>
            )}
            {checkState === "error" && (
              <div className="banner-inner">
                <span className="x-icon">!</span>
                <div>
                  <strong>Check failed</strong>
                  <span className="banner-detail">{error}</span>
                </div>
                <button className="banner-cta" onClick={() => checkAttestation(address)}>Retry</button>
              </div>
            )}
          </div>
        )}

        {/* ── Tickets ───────────────────────────────────────────────────── */}
        <section className="tickets-section">
          <div className="section-label">TICKETS</div>
          <h2 className="section-title">
            {isVerified ? "Your Exclusive Pricing" : "Choose Your Pass"}
          </h2>
          {!address && (
            <p className="section-hint">
              Connect your wallet and verify your PAN to unlock <strong>50% off</strong> every tier.
            </p>
          )}

          <div className="tickets-grid">
            {TICKETS.map((t) => (
              <div
                key={t.tier}
                className={`ticket-card ${t.tier === "Builder" ? "ticket-card--featured" : ""} ${selectedTier === t.tier ? "ticket-card--selected" : ""}`}
                onClick={() => setSelectedTier(t.tier)}
              >
                {t.tier === "Builder" && <div className="featured-badge">Most Popular</div>}
                <div className="ticket-tier">{t.tier}</div>

                <div className="ticket-price-wrap">
                  {isVerified && (
                    <span className="price-original">₹{t.original.toLocaleString("en-IN")}</span>
                  )}
                  <span className="price-current">
                    ₹{(isVerified ? t.discounted : t.original).toLocaleString("en-IN")}
                  </span>
                  {isVerified && <span className="price-save">Save ₹{(t.original - t.discounted).toLocaleString("en-IN")}</span>}
                </div>

                <ul className="perk-list">
                  {t.perks.map((p) => (
                    <li key={p}>
                      <span className="perk-check">✓</span> {p}
                    </li>
                  ))}
                </ul>

                {!address ? (
                  <button className="ticket-btn" onClick={() => setShowModal(true)}>
                    Connect to Buy
                  </button>
                ) : isVerified ? (
                  <button className="ticket-btn ticket-btn--primary">
                    Buy at ₹{t.discounted.toLocaleString("en-IN")} →
                  </button>
                ) : (
                  <button className="ticket-btn ticket-btn--muted">
                    <a href="/generate" style={{ color: "inherit", textDecoration: "none" }}>
                      Verify PAN for 50% off
                    </a>
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* ── How it works ──────────────────────────────────────────────── */}
        {!isVerified && (
          <section className="how-section">
            <div className="section-label">HOW IT WORKS</div>
            <h2 className="section-title">Verify once. Save everywhere.</h2>
            <div className="how-grid">
              {[
                { n: "01", title: "Generate ZK Proof", body: "Upload your DigiLocker PAN XML. A zero-knowledge proof is generated entirely in your browser — your data never leaves your device.", href: "/generate", cta: "Generate →" },
                { n: "02", title: "Submit On-Chain", body: "The proof is verified by a smart contract on Paseo Asset Hub. Your PAN ownership is attested without revealing any personal details.", href: null, cta: null },
                { n: "03", title: "Claim Your Discount", body: "Return here with the same wallet. We check your on-chain attestation and apply 50% off instantly — no codes, no friction.", href: null, cta: null },
              ].map(({ n, title, body, href, cta }) => (
                <div key={n} className="how-card">
                  <span className="how-num">{n}</span>
                  <h3 className="how-title">{title}</h3>
                  <p className="how-body">{body}</p>
                  {href && cta && <a href={href} className="how-link">{cta}</a>}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── Speakers strip ────────────────────────────────────────────── */}
        <section className="speakers-section">
          <div className="section-label">SPEAKERS</div>
          <div className="speakers-scroll">
            {["Gavin Wood", "Shawn Tabrizi", "Maciej Kris Żyszkiewicz", "Kian Paimani", "Francisco Aguirre​", "Radhakrishna Dasari"].map((s) => (
              <div key={s} className="speaker-chip">
                <span className="speaker-avatar">{s[0]}</span>
                <span>{s}</span>
              </div>
            ))}
          </div>
        </section>

        {/* ── Footer ────────────────────────────────────────────────────── */}
        <footer className="event-footer">
          <div className="footer-brand">
            <span className="nav-dot" />
            <span>Polkadot India Summit 2025</span>
          </div>
          <p className="footer-note">
            Discounts verified via ZK PAN attestation on Paseo Asset Hub ·{" "}
            <a href="/verify">Check attestation →</a>
          </p>
        </footer>
      </div>
    </>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Mono:wght@400;500&family=DM+Sans:wght@300;400;500&display=swap');

  :root {
    --bg: #08090a;
    --surface: #111215;
    --surface-2: #18191e;
    --border: rgba(255,255,255,0.07);
    --border-bright: rgba(255,255,255,0.13);
    --ink: #f0ede8;
    --muted: #6b6f7a;
    --pink: #e6007a;
    --pink-dim: rgba(230,0,122,0.12);
    --green: #56f39a;
    --green-dim: rgba(86,243,154,0.1);
    --amber: #f0a500;
    --amber-dim: rgba(240,165,0,0.1);
    --radius: 12px;
    --radius-lg: 20px;
    --mono: 'DM Mono', monospace;
    --display: 'Syne', sans-serif;
    --body: 'DM Sans', sans-serif;
  }

  .event-root {
    min-height: 100vh;
    background: var(--bg);
    color: var(--ink);
    font-family: var(--body);
    position: relative;
    overflow-x: hidden;
  }

  /* Noise */
  .noise {
    pointer-events: none;
    position: fixed;
    inset: 0;
    z-index: 0;
    opacity: 0.025;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E");
    background-size: 200px;
  }

  /* Nav */
  .nav {
    position: fixed;
    top: 0; left: 0; right: 0;
    z-index: 50;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1.25rem 2.5rem;
    background: rgba(8,9,10,0.85);
    backdrop-filter: blur(16px);
    border-bottom: 1px solid var(--border);
  }
  .nav-logo {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    font-family: var(--display);
    font-weight: 700;
    font-size: 0.95rem;
    letter-spacing: 0.02em;
  }
  .nav-dot {
    width: 8px; height: 8px;
    border-radius: 50%;
    background: var(--pink);
    box-shadow: 0 0 8px var(--pink);
    animation: pulse-dot 2s ease-in-out infinite;
  }
  @keyframes pulse-dot {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.6; transform: scale(0.85); }
  }
  .nav-wallet {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    background: var(--surface-2);
    border: 1px solid var(--border-bright);
    border-radius: 100px;
    padding: 0.4rem 0.875rem;
    font-size: 0.85rem;
  }
  .status-dot {
    width: 7px; height: 7px; border-radius: 50%;
  }
  .status-dot--green { background: var(--green); box-shadow: 0 0 6px var(--green); }
  .status-dot--amber { background: var(--amber); box-shadow: 0 0 6px var(--amber); }
  .nav-addr { font-family: var(--mono); font-size: 0.78rem; color: var(--ink); }
  .btn-disconnect {
    font-family: var(--body);
    background: none;
    border: none;
    color: var(--muted);
    font-size: 0.75rem;
    cursor: pointer;
    padding: 0;
    transition: color 0.2s;
  }
  .btn-disconnect:hover { color: var(--ink); }
  .btn-connect {
    font-family: var(--body);
    background: var(--pink);
    color: #fff;
    border: none;
    border-radius: 100px;
    padding: 0.6rem 1.5rem;
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
    box-shadow: 0 0 20px rgba(230,0,122,0.3);
  }
  .btn-connect:hover {
    background: #ff2d8e;
    box-shadow: 0 0 32px rgba(230,0,122,0.5);
    transform: translateY(-1px);
  }

  /* Hero */
  .hero {
    position: relative;
    padding: 12rem 2.5rem 6rem;
    text-align: center;
    max-width: 900px;
    margin: 0 auto;
  }
  .hero-eyebrow {
    display: flex;
    justify-content: center;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-bottom: 2rem;
    animation: fade-up 0.6s ease both;
  }
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font-family: var(--mono);
    font-size: 0.72rem;
    font-weight: 500;
    color: var(--muted);
    border: 1px solid var(--border-bright);
    border-radius: 100px;
    padding: 0.3rem 0.875rem;
    letter-spacing: 0.04em;
  }
  .pill--pink { color: var(--pink); border-color: rgba(230,0,122,0.3); }
  .hero-title {
    font-family: var(--display);
    font-size: clamp(3rem, 8vw, 6.5rem);
    font-weight: 800;
    line-height: 1.0;
    letter-spacing: -0.03em;
    color: var(--ink);
    margin-bottom: 1.5rem;
    animation: fade-up 0.6s 0.1s ease both;
  }
  .hero-title em {
    font-style: italic;
    background: linear-gradient(135deg, var(--pink) 0%, #a855f7 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }
  .hero-sub {
    font-size: 1.05rem;
    line-height: 1.75;
    color: var(--muted);
    max-width: 560px;
    margin: 0 auto 3rem;
    animation: fade-up 0.6s 0.2s ease both;
  }

  /* Countdown */
  .countdown {
    display: flex;
    justify-content: center;
    gap: 1rem;
    animation: fade-up 0.6s 0.3s ease both;
  }
  .count-block {
    display: flex;
    flex-direction: column;
    align-items: center;
    background: var(--surface);
    border: 1px solid var(--border-bright);
    border-radius: var(--radius);
    padding: 1.25rem 1.5rem;
    min-width: 80px;
  }
  .count-num {
    font-family: var(--display);
    font-size: 2.25rem;
    font-weight: 800;
    color: var(--ink);
    line-height: 1;
    margin-bottom: 0.375rem;
  }
  .count-label {
    font-family: var(--mono);
    font-size: 0.65rem;
    color: var(--muted);
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }

  /* Attestation banner */
  .attest-banner {
    margin: 0 2.5rem 2rem;
    border-radius: var(--radius-lg);
    padding: 1.25rem 1.75rem;
    border: 1px solid var(--border);
    animation: fade-up 0.4s ease both;
  }
  .attest-banner--checking { background: var(--surface); }
  .attest-banner--verified { background: var(--green-dim); border-color: rgba(86,243,154,0.25); }
  .attest-banner--unverified { background: var(--amber-dim); border-color: rgba(240,165,0,0.25); }
  .attest-banner--error { background: rgba(239,68,68,0.08); border-color: rgba(239,68,68,0.25); }
  .banner-inner {
    display: flex;
    align-items: center;
    gap: 1rem;
    flex-wrap: wrap;
  }
  .banner-inner strong { display: block; font-size: 0.925rem; color: var(--ink); }
  .banner-detail {
    display: block;
    font-size: 0.78rem;
    color: var(--muted);
    font-family: var(--mono);
    margin-top: 0.2rem;
  }
  .check-icon {
    width: 36px; height: 36px; border-radius: 50%;
    background: var(--green); color: #08090a;
    display: flex; align-items: center; justify-content: center;
    font-weight: 700; font-size: 1rem; flex-shrink: 0;
  }
  .x-icon {
    width: 36px; height: 36px; border-radius: 50%;
    background: var(--amber); color: #08090a;
    display: flex; align-items: center; justify-content: center;
    font-weight: 700; font-size: 1rem; flex-shrink: 0;
  }
  .discount-tag {
    margin-left: auto;
    background: var(--pink);
    color: #fff;
    font-family: var(--display);
    font-weight: 800;
    font-size: 1.1rem;
    padding: 0.35rem 1rem;
    border-radius: 100px;
    box-shadow: 0 0 20px rgba(230,0,122,0.4);
  }
  .banner-cta {
    margin-left: auto;
    background: var(--ink);
    color: var(--bg);
    border: none;
    border-radius: 100px;
    padding: 0.5rem 1.25rem;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
    text-decoration: none;
    font-family: var(--body);
    transition: all 0.2s;
  }
  .banner-cta:hover { opacity: 0.85; }
  .spinner {
    width: 20px; height: 20px;
    border: 2px solid var(--border-bright);
    border-top-color: var(--ink);
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
    flex-shrink: 0;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* Tickets */
  .tickets-section {
    padding: 4rem 2.5rem;
    max-width: 1100px;
    margin: 0 auto;
  }
  .section-label {
    font-family: var(--mono);
    font-size: 0.68rem;
    font-weight: 500;
    color: var(--pink);
    letter-spacing: 0.18em;
    text-transform: uppercase;
    margin-bottom: 0.75rem;
  }
  .section-title {
    font-family: var(--display);
    font-size: clamp(1.75rem, 3.5vw, 2.75rem);
    font-weight: 800;
    letter-spacing: -0.02em;
    color: var(--ink);
    margin-bottom: 1rem;
  }
  .section-hint {
    color: var(--muted);
    font-size: 0.95rem;
    margin-bottom: 2.5rem;
  }
  .section-hint strong { color: var(--pink); }
  .tickets-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 1.25rem;
  }
  @media (max-width: 900px) {
    .tickets-grid { grid-template-columns: 1fr; max-width: 420px; margin: 0 auto; }
  }
  .ticket-card {
    position: relative;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 2rem 1.75rem;
    cursor: pointer;
    transition: all 0.2s;
  }
  .ticket-card:hover { border-color: var(--border-bright); transform: translateY(-2px); }
  .ticket-card--featured {
    border-color: rgba(230,0,122,0.4);
    background: linear-gradient(160deg, rgba(230,0,122,0.06) 0%, var(--surface) 60%);
    box-shadow: 0 0 40px rgba(230,0,122,0.1);
  }
  .ticket-card--selected { border-color: var(--pink) !important; }
  .featured-badge {
    position: absolute;
    top: -1px; left: 50%; transform: translateX(-50%);
    background: var(--pink);
    color: #fff;
    font-size: 0.68rem;
    font-weight: 700;
    font-family: var(--mono);
    letter-spacing: 0.1em;
    padding: 0.2rem 0.875rem;
    border-radius: 0 0 8px 8px;
    text-transform: uppercase;
  }
  .ticket-tier {
    font-family: var(--display);
    font-weight: 700;
    font-size: 1.1rem;
    color: var(--ink);
    margin-bottom: 1.25rem;
    margin-top: 0.5rem;
  }
  .ticket-price-wrap {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    margin-bottom: 1.5rem;
    min-height: 5rem;
  }
  .price-original {
    font-size: 0.9rem;
    color: var(--muted);
    text-decoration: line-through;
    font-family: var(--mono);
  }
  .price-current {
    font-family: var(--display);
    font-size: 2.25rem;
    font-weight: 800;
    color: var(--ink);
    line-height: 1;
  }
  .price-save {
    font-size: 0.75rem;
    font-family: var(--mono);
    color: var(--green);
    margin-top: 0.25rem;
  }
  .perk-list {
    list-style: none;
    padding: 0; margin: 0 0 1.75rem;
    display: flex; flex-direction: column; gap: 0.5rem;
  }
  .perk-list li {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.85rem;
    color: var(--muted);
  }
  .perk-check { color: var(--green); font-size: 0.8rem; }
  .ticket-btn {
    width: 100%;
    padding: 0.875rem;
    border: 1px solid var(--border-bright);
    border-radius: var(--radius);
    background: transparent;
    color: var(--ink);
    font-family: var(--body);
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
  }
  .ticket-btn:hover { background: var(--surface-2); }
  .ticket-btn--primary {
    background: var(--pink);
    border-color: var(--pink);
    color: #fff;
    box-shadow: 0 0 20px rgba(230,0,122,0.3);
  }
  .ticket-btn--primary:hover {
    background: #ff2d8e;
    box-shadow: 0 0 32px rgba(230,0,122,0.5);
  }
  .ticket-btn--muted { color: var(--muted); font-size: 0.8rem; }

  /* How it works */
  .how-section {
    padding: 4rem 2.5rem;
    max-width: 1100px;
    margin: 0 auto;
    border-top: 1px solid var(--border);
  }
  .how-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 1.5rem;
    margin-top: 2rem;
  }
  @media (max-width: 900px) { .how-grid { grid-template-columns: 1fr; } }
  .how-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 2rem 1.75rem;
  }
  .how-num {
    font-family: var(--display);
    font-size: 3rem;
    font-weight: 800;
    color: var(--border-bright);
    line-height: 1;
    display: block;
    margin-bottom: 1rem;
  }
  .how-title {
    font-family: var(--display);
    font-size: 1.15rem;
    font-weight: 700;
    color: var(--ink);
    margin-bottom: 0.625rem;
  }
  .how-body {
    font-size: 0.875rem;
    color: var(--muted);
    line-height: 1.7;
    margin-bottom: 1rem;
  }
  .how-link {
    font-size: 0.85rem;
    color: var(--pink);
    text-decoration: none;
    font-weight: 500;
  }
  .how-link:hover { text-decoration: underline; }

  /* Speakers */
  .speakers-section {
    padding: 3rem 2.5rem;
    border-top: 1px solid var(--border);
  }
  .speakers-scroll {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    margin-top: 1.25rem;
  }
  .speaker-chip {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 100px;
    padding: 0.5rem 1rem 0.5rem 0.5rem;
    font-size: 0.85rem;
    color: var(--muted);
    transition: all 0.2s;
  }
  .speaker-chip:hover { border-color: var(--border-bright); color: var(--ink); }
  .speaker-avatar {
    width: 28px; height: 28px;
    border-radius: 50%;
    background: linear-gradient(135deg, var(--pink), #a855f7);
    color: #fff;
    display: flex; align-items: center; justify-content: center;
    font-weight: 700; font-size: 0.75rem;
    font-family: var(--display);
    flex-shrink: 0;
  }

  /* Footer */
  .event-footer {
    padding: 2.5rem;
    border-top: 1px solid var(--border);
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 1rem;
  }
  .footer-brand {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    font-family: var(--display);
    font-size: 0.9rem;
    font-weight: 700;
    color: var(--muted);
  }
  .footer-note {
    font-size: 0.78rem;
    color: var(--muted);
    font-family: var(--mono);
  }
  .footer-note a { color: var(--muted); }
  .footer-note a:hover { color: var(--pink); }

  /* Modal */
  .modal-backdrop {
    position: fixed; inset: 0; z-index: 200;
    background: rgba(0,0,0,0.75);
    backdrop-filter: blur(8px);
    display: flex; align-items: center; justify-content: center;
    padding: 1rem;
  }
  .modal {
    background: var(--surface);
    border: 1px solid var(--border-bright);
    border-radius: var(--radius-lg);
    padding: 2rem;
    width: 100%;
    max-width: 400px;
    animation: fade-up 0.25s ease both;
  }
  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.5rem;
  }
  .modal-title {
    font-family: var(--display);
    font-size: 1.25rem;
    font-weight: 800;
    color: var(--ink);
  }
  .modal-close {
    background: none; border: none;
    color: var(--muted); font-size: 1rem;
    cursor: pointer; padding: 0.25rem;
    transition: color 0.2s;
  }
  .modal-close:hover { color: var(--ink); }
  .modal-sub {
    font-size: 0.85rem;
    color: var(--muted);
    margin-bottom: 1.5rem;
  }
  .wallet-list {
    display: flex;
    flex-direction: column;
    gap: 0.625rem;
    margin-bottom: 1.25rem;
  }
  .wallet-btn {
    display: flex;
    align-items: center;
    gap: 0.875rem;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.875rem 1rem;
    cursor: pointer;
    transition: all 0.2s;
    color: var(--ink);
    font-family: var(--body);
    font-size: 0.9rem;
  }
  .wallet-btn:hover:not(.wallet-btn--disabled) {
    border-color: var(--border-bright);
    background: #1e1f24;
  }
  .wallet-btn--disabled { opacity: 0.4; cursor: not-allowed; }
  .wallet-icon { font-size: 1.25rem; }
  .wallet-name { font-weight: 500; flex: 1; text-align: left; }
  .wallet-badge {
    font-size: 0.7rem;
    font-family: var(--mono);
    color: var(--muted);
    border: 1px solid var(--border);
    border-radius: 100px;
    padding: 0.15rem 0.5rem;
  }
  .wallet-arrow { color: var(--muted); font-size: 0.9rem; margin-left: auto; }
  .no-wallet {
    text-align: center;
    padding: 1.5rem;
    color: var(--muted);
    font-size: 0.875rem;
    line-height: 1.6;
  }
  .no-wallet a { color: var(--pink); text-decoration: none; }
  .modal-note {
    font-size: 0.72rem;
    font-family: var(--mono);
    color: var(--muted);
    text-align: center;
  }

  @keyframes fade-up {
    from { opacity: 0; transform: translateY(16px); }
    to { opacity: 1; transform: translateY(0); }
  }
`;