/**
 * ZKPanHomePage.tsx
 *
 * Drop into: web/src/pages/ZKPanHomePage.tsx
 *
 * Add to main.tsx routes (replace or add alongside existing index route):
 *   import ZKPanHomePage from './pages/ZKPanHomePage';
 *   <Route index element={<Suspense fallback={routeFallback}><ZKPanHomePage /></Suspense>} />
 *
 * Or add as a separate route if you want to keep the template's HomePage:
 *   <Route path="zkpan" element={<Suspense fallback={routeFallback}><ZKPanHomePage /></Suspense>} />
 *
 * Zero dependencies beyond React.
 */

export default function ZKPanHomePage() {
  return (
    <>
      <style>{CSS}</style>
      <div className="home-root">
        <div className="home-noise" />

        {/* Ambient orbs */}
        <div className="home-orb home-orb-1" />
        <div className="home-orb home-orb-2" />

        {/* ── Nav ─────────────────────────────────────────────────────────── */}
        <header className="home-header">
          <div className="home-logo">
            <span className="home-logo-dot" />
            <span className="home-logo-text">ZK PAN</span>
          </div>
          <nav className="home-nav">
            <a href="#/generate" className="home-nav-link">Generate Proof</a>
            <a href="#/verify" className="home-nav-link">Verify Proof</a>
            <a href="#/event" className="home-nav-link home-nav-highlight">India Summit →</a>
          </nav>
        </header>

        {/* ── Hero ────────────────────────────────────────────────────────── */}
        <section className="home-hero">
          <div className="home-hero-tag">
            <span className="home-tag-pulse" />
            Zero-Knowledge Identity
          </div>

          <h1 className="home-hero-title">
            Prove your identity.<br />
            <em>Reveal nothing.</em>
          </h1>

          <p className="home-hero-sub">
            Cryptographic proof of your PAN card — verified by the Indian government's
            RSA signature, computed entirely on your device. No data leaves your browser.
          </p>

          <div className="home-hero-cta">
            <a href="#/generate" className="home-cta-primary">
              Generate Proof
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5"
                  strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </a>
            <a href="#/verify" className="home-cta-secondary">
              Verify a Proof
            </a>
          </div>
        </section>

        {/* ── Trust strip ─────────────────────────────────────────────────── */}
        <div className="home-trust">
          {[
            {
              icon: (
                <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
                  <path d="M10 2L3 5v5c0 4.418 3.134 8.56 7 9.5C13.866 18.56 17 14.418 17 10V5L10 2z"
                    stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                </svg>
              ),
              label: "Your XML stays on your device",
            },
            {
              icon: (
                <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
                  <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M7 10l2 2 4-4" stroke="currentColor" strokeWidth="1.5"
                    strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ),
              label: "RSA-2048 signature verified",
            },
            {
              icon: (
                <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
                  <path d="M10 3v14M3 10h14" stroke="currentColor" strokeWidth="1.5"
                    strokeLinecap="round" />
                </svg>
              ),
              label: "Groth16 zero-knowledge proof",
            },
            {
              icon: (
                <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
                  <rect x="3" y="3" width="14" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M7 10h6M10 7v6" stroke="currentColor" strokeWidth="1.5"
                    strokeLinecap="round" />
                </svg>
              ),
              label: "On-chain attestation via Paseo",
            },
          ].map(({ icon, label }, i) => (
            <div key={i} className="home-trust-item">
              {icon}
              <span>{label}</span>
            </div>
          ))}
        </div>

        {/* ── How it works ─────────────────────────────────────────────────── */}
        <section className="home-how">
          <div className="home-section-label">HOW IT WORKS</div>
          <h2 className="home-section-title">Three steps. Total privacy.</h2>

          <div className="home-how-grid">
            {[
              {
                n: "01",
                title: "Upload your XML",
                body: "Download your PAN card XML from DigiLocker. Upload it here — it never leaves your device. No server ever sees it.",
                href: "#/generate",
                cta: "Go to Generate →",
              },
              {
                n: "02",
                title: "Proof is generated",
                body: "Your browser verifies the government's RSA-2048 signature and runs the Groth16 prover locally. Takes 2–3 minutes.",
                href: null,
                cta: null,
              },
              {
                n: "03",
                title: "Verify on-chain",
                body: "Submit the proof to a smart contract on Paseo Asset Hub. Anyone can verify you hold a valid PAN — without knowing your details.",
                href: "#/verify",
                cta: "Go to Verify →",
              },
            ].map(({ n, title, body, href, cta }) => (
              <div key={n} className="home-how-card">
                <span className="home-how-num">{n}</span>
                <h3 className="home-how-title">{title}</h3>
                <p className="home-how-body">{body}</p>
                {href && cta && (
                  <a href={href} className="home-how-link">{cta}</a>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* ── Event CTA banner ────────────────────────────────────────────── */}
        <section className="home-event-banner">
          <div className="home-event-inner">
            <div className="home-event-left">
              <div className="home-event-pill">🇮🇳 September 15–17, 2025 · Bengaluru</div>
              <h2 className="home-event-title">India's Biggest Web3 Summit</h2>
              <p className="home-event-body">
                Verify your PAN on-chain to unlock a <strong>50% discount</strong> on all ticket tiers.
                Zero knowledge, zero friction.
              </p>
            </div>
            <div className="home-event-right">
              <a href="#/event" className="home-event-cta">
                Claim Discount
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                  <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5"
                    strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </a>
              <p className="home-event-note">Connect wallet → Check attestation → Save 50%</p>
            </div>
          </div>
        </section>

        {/* ── Tech stack strip ─────────────────────────────────────────────── */}
        <section className="home-tech">
          <div className="home-section-label">BUILT WITH</div>
          <div className="home-tech-grid">
            {[
              { name: "Circom + SnarkJS", desc: "ZK circuit & Groth16 prover" },
              { name: "Paseo Asset Hub", desc: "EVM-compatible Polkadot testnet" },
              { name: "AttestationRegistry", desc: "Protocol Commons v1" },
              { name: "xmldsigjs", desc: "RSA-2048 XML signature" },
              { name: "viem", desc: "On-chain reads & writes" },
              { name: "DigiLocker", desc: "Government-signed PAN XML" },
            ].map(({ name, desc }) => (
              <div key={name} className="home-tech-card">
                <span className="home-tech-name">{name}</span>
                <span className="home-tech-desc">{desc}</span>
              </div>
            ))}
          </div>
        </section>

        {/* ── Footer ──────────────────────────────────────────────────────── */}
        <footer className="home-footer">
          <div className="home-footer-brand">
            <span className="home-logo-dot" style={{ width: 6, height: 6 }} />
            <span>ZK PAN Verifier</span>
          </div>
          <p className="home-footer-note">
            Built on{" "}
            <a href="https://polkadot.network" target="_blank" rel="noopener noreferrer">
              Polkadot
            </a>{" "}
            · Open source · No data leaves your device
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
    --h-bg: #08090a;
    --h-surface: #111215;
    --h-surface2: #18191e;
    --h-border: rgba(255,255,255,0.07);
    --h-border-bright: rgba(255,255,255,0.13);
    --h-ink: #f0ede8;
    --h-muted: #6b6f7a;
    --h-pink: #e6007a;
    --h-pink-dim: rgba(230,0,122,0.1);
    --h-green: #56f39a;
    --h-purple: #a855f7;
    --h-radius: 12px;
    --h-radius-lg: 20px;
    --h-mono: 'DM Mono', monospace;
    --h-display: 'Syne', sans-serif;
    --h-body: 'DM Sans', sans-serif;
    --h-t: 0.18s ease;
  }

  .home-root {
    min-height: 100vh;
    background: var(--h-bg);
    color: var(--h-ink);
    font-family: var(--h-body);
    position: relative;
    overflow-x: hidden;
  }

  /* Noise */
  .home-noise {
    pointer-events: none; position: fixed; inset: 0; z-index: 0; opacity: 0.025;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
    background-size: 200px;
  }

  /* Orbs */
  .home-orb {
    pointer-events: none; position: fixed; border-radius: 50%;
    filter: blur(120px); opacity: 0.08; z-index: 0;
  }
  .home-orb-1 { width: 600px; height: 600px; background: var(--h-pink); top: -200px; right: -150px; }
  .home-orb-2 { width: 500px; height: 500px; background: var(--h-purple); bottom: -200px; left: -150px; }

  /* Nav */
  .home-header {
    position: fixed; top: 0; left: 0; right: 0; z-index: 50;
    display: flex; align-items: center; justify-content: space-between;
    padding: 1.25rem 2.5rem;
    background: rgba(8,9,10,0.85); backdrop-filter: blur(16px);
    border-bottom: 1px solid var(--h-border);
  }
  .home-logo {
    display: flex; align-items: center; gap: 0.625rem;
    font-family: var(--h-display); font-weight: 800; font-size: 1.05rem;
    color: var(--h-ink); text-decoration: none;
  }
  .home-logo-dot {
    width: 8px; height: 8px; border-radius: 50%;
    background: var(--h-pink); box-shadow: 0 0 8px var(--h-pink);
    animation: h-pulse 2s ease-in-out infinite; flex-shrink: 0;
  }
  @keyframes h-pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.5;transform:scale(0.8)} }
  .home-logo-text { letter-spacing: 0.06em; }
  .home-nav { display: flex; align-items: center; gap: 1.75rem; }
  .home-nav-link {
    font-size: 0.875rem; font-weight: 500; color: var(--h-muted);
    text-decoration: none; transition: color var(--h-t); letter-spacing: 0.01em;
  }
  .home-nav-link:hover { color: var(--h-ink); }
  .home-nav-highlight {
    color: var(--h-pink) !important;
    font-weight: 600;
  }

  /* Hero */
  .home-hero {
    position: relative; z-index: 1;
    display: flex; flex-direction: column; align-items: center;
    text-align: center; padding: 11rem 2rem 5rem;
    max-width: 860px; margin: 0 auto;
    animation: h-fade-up 0.7s ease both;
  }
  .home-hero-tag {
    display: inline-flex; align-items: center; gap: 0.5rem;
    font-family: var(--h-mono); font-size: 0.72rem; font-weight: 500;
    letter-spacing: 0.12em; text-transform: uppercase;
    color: var(--h-pink); background: var(--h-pink-dim);
    border: 1px solid rgba(230,0,122,0.25);
    padding: 0.35rem 0.9rem; border-radius: 100px; margin-bottom: 2rem;
  }
  .home-tag-pulse {
    width: 6px; height: 6px; border-radius: 50%; background: var(--h-pink);
    animation: h-pulse 2s ease-in-out infinite;
  }
  .home-hero-title {
    font-family: var(--h-display);
    font-size: clamp(3rem, 7vw, 5.5rem);
    font-weight: 800; line-height: 1.05; letter-spacing: -0.03em;
    color: var(--h-ink); margin-bottom: 1.5rem;
    animation: h-fade-up 0.6s 0.1s ease both;
  }
  .home-hero-title em {
    font-style: italic;
    background: linear-gradient(135deg, var(--h-pink) 0%, var(--h-purple) 100%);
    -webkit-background-clip: text; -webkit-text-fill-color: transparent;
    background-clip: text;
  }
  .home-hero-sub {
    font-size: 1.1rem; line-height: 1.75; max-width: 560px;
    color: var(--h-muted); margin-bottom: 3rem;
    animation: h-fade-up 0.6s 0.15s ease both;
  }
  .home-hero-cta {
    display: flex; gap: 1rem; align-items: center;
    flex-wrap: wrap; justify-content: center;
    animation: h-fade-up 0.6s 0.2s ease both;
  }
  .home-cta-primary {
    display: inline-flex; align-items: center; gap: 0.5rem;
    background: var(--h-pink); color: #fff; text-decoration: none;
    padding: 0.9rem 1.875rem; border-radius: var(--h-radius);
    font-size: 0.95rem; font-weight: 600;
    transition: all var(--h-t);
    box-shadow: 0 0 24px rgba(230,0,122,0.35);
  }
  .home-cta-primary:hover {
    background: #ff2d8e; transform: translateY(-2px);
    box-shadow: 0 0 40px rgba(230,0,122,0.55);
  }
  .home-cta-secondary {
    display: inline-flex; align-items: center;
    color: var(--h-muted); text-decoration: none;
    padding: 0.9rem 1.5rem;
    border: 1px solid var(--h-border-bright); border-radius: var(--h-radius);
    font-size: 0.95rem; font-weight: 500; transition: all var(--h-t);
  }
  .home-cta-secondary:hover {
    color: var(--h-ink); border-color: var(--h-ink);
    background: rgba(255,255,255,0.04);
  }

  /* Trust strip */
  .home-trust {
    position: relative; z-index: 1;
    display: flex; align-items: center; justify-content: center;
    flex-wrap: wrap; gap: 0;
    border-top: 1px solid var(--h-border); border-bottom: 1px solid var(--h-border);
    background: var(--h-surface);
  }
  .home-trust-item {
    display: flex; align-items: center; gap: 0.6rem;
    padding: 1rem 1.75rem; color: var(--h-muted);
    font-size: 0.82rem; font-weight: 500;
    border-right: 1px solid var(--h-border);
    transition: color var(--h-t);
  }
  .home-trust-item:last-child { border-right: none; }
  .home-trust-item:hover { color: var(--h-ink); }

  /* How it works */
  .home-how {
    position: relative; z-index: 1;
    padding: 5rem 2.5rem; max-width: 1100px; margin: 0 auto;
    animation: h-fade-up 0.6s ease both;
  }
  .home-section-label {
    font-family: var(--h-mono); font-size: 0.68rem; font-weight: 500;
    color: var(--h-pink); letter-spacing: 0.18em;
    text-transform: uppercase; margin-bottom: 0.75rem;
  }
  .home-section-title {
    font-family: var(--h-display);
    font-size: clamp(1.75rem, 3vw, 2.5rem);
    font-weight: 800; letter-spacing: -0.02em;
    color: var(--h-ink); margin-bottom: 2.5rem;
  }
  .home-how-grid {
    display: grid; grid-template-columns: repeat(3, 1fr); gap: 1.5rem;
  }
  @media (max-width: 768px) { .home-how-grid { grid-template-columns: 1fr; } }
  .home-how-card {
    background: var(--h-surface); border: 1px solid var(--h-border);
    border-radius: var(--h-radius-lg); padding: 2rem 1.75rem;
    transition: border-color var(--h-t);
  }
  .home-how-card:hover { border-color: var(--h-border-bright); }
  .home-how-num {
    display: block; font-family: var(--h-display); font-size: 3.5rem;
    font-weight: 800; color: var(--h-border-bright); line-height: 1; margin-bottom: 1rem;
  }
  .home-how-title {
    font-family: var(--h-display); font-size: 1.15rem; font-weight: 700;
    color: var(--h-ink); margin-bottom: 0.625rem;
  }
  .home-how-body {
    font-size: 0.9rem; color: var(--h-muted); line-height: 1.7; margin-bottom: 1rem;
  }
  .home-how-link {
    font-size: 0.85rem; color: var(--h-pink); text-decoration: none; font-weight: 500;
  }
  .home-how-link:hover { text-decoration: underline; }

  /* Event banner */
  .home-event-banner {
    position: relative; z-index: 1;
    margin: 0 2.5rem 4rem; border-radius: var(--h-radius-lg);
    background: linear-gradient(135deg, rgba(230,0,122,0.12) 0%, rgba(168,85,247,0.08) 100%);
    border: 1px solid rgba(230,0,122,0.25);
    overflow: hidden;
  }
  .home-event-inner {
    display: flex; align-items: center; justify-content: space-between;
    gap: 2rem; padding: 2.5rem 2.5rem; flex-wrap: wrap;
  }
  .home-event-left { flex: 1; min-width: 260px; }
  .home-event-pill {
    display: inline-block; font-family: var(--h-mono); font-size: 0.72rem;
    color: var(--h-pink); background: rgba(230,0,122,0.1);
    border: 1px solid rgba(230,0,122,0.2);
    border-radius: 100px; padding: 0.3rem 0.875rem; margin-bottom: 0.875rem;
    letter-spacing: 0.06em;
  }
  .home-event-title {
    font-family: var(--h-display); font-size: 1.75rem; font-weight: 800;
    color: var(--h-ink); letter-spacing: -0.02em; margin-bottom: 0.5rem;
  }
  .home-event-body {
    font-size: 0.9rem; color: var(--h-muted); line-height: 1.6;
  }
  .home-event-body strong { color: var(--h-green); }
  .home-event-right {
    display: flex; flex-direction: column; align-items: flex-start; gap: 0.625rem;
  }
  .home-event-cta {
    display: inline-flex; align-items: center; gap: 0.5rem;
    background: var(--h-pink); color: #fff; text-decoration: none;
    padding: 0.875rem 1.75rem; border-radius: var(--h-radius);
    font-size: 0.95rem; font-weight: 600; white-space: nowrap;
    transition: all var(--h-t); box-shadow: 0 0 20px rgba(230,0,122,0.3);
  }
  .home-event-cta:hover {
    background: #ff2d8e; box-shadow: 0 0 32px rgba(230,0,122,0.5);
    transform: translateY(-1px);
  }
  .home-event-note {
    font-size: 0.75rem; font-family: var(--h-mono);
    color: var(--h-muted); white-space: nowrap;
  }

  /* Tech stack */
  .home-tech {
    position: relative; z-index: 1;
    padding: 0 2.5rem 5rem; max-width: 1100px; margin: 0 auto;
  }
  .home-tech-grid {
    display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; margin-top: 1.5rem;
  }
  @media (max-width: 768px) { .home-tech-grid { grid-template-columns: repeat(2, 1fr); } }
  @media (max-width: 480px) { .home-tech-grid { grid-template-columns: 1fr; } }
  .home-tech-card {
    background: var(--h-surface); border: 1px solid var(--h-border);
    border-radius: var(--h-radius); padding: 1rem 1.25rem;
    display: flex; flex-direction: column; gap: 0.25rem;
    transition: border-color var(--h-t);
  }
  .home-tech-card:hover { border-color: var(--h-border-bright); }
  .home-tech-name {
    font-family: var(--h-mono); font-size: 0.82rem; font-weight: 500;
    color: var(--h-ink);
  }
  .home-tech-desc { font-size: 0.78rem; color: var(--h-muted); }

  /* Footer */
  .home-footer {
    position: relative; z-index: 1;
    padding: 2rem 2.5rem;
    border-top: 1px solid var(--h-border);
    display: flex; align-items: center; justify-content: space-between;
    flex-wrap: wrap; gap: 1rem;
  }
  .home-footer-brand {
    display: flex; align-items: center; gap: 0.625rem;
    font-family: var(--h-display); font-weight: 700;
    font-size: 0.9rem; color: var(--h-muted);
  }
  .home-footer-note { font-size: 0.78rem; color: var(--h-muted); font-family: var(--h-mono); }
  .home-footer-note a { color: var(--h-muted); text-decoration: none; }
  .home-footer-note a:hover { color: var(--h-pink); }

  @keyframes h-fade-up {
    from { opacity: 0; transform: translateY(16px); }
    to { opacity: 1; transform: translateY(0); }
  }

  @media (max-width: 600px) {
    .home-header { padding: 1rem 1.25rem; }
    .home-nav { gap: 1rem; }
    .home-nav-link { font-size: 0.8rem; }
    .home-how, .home-tech { padding-left: 1.25rem; padding-right: 1.25rem; }
    .home-event-banner { margin: 0 1.25rem 3rem; }
    .home-event-inner { padding: 1.75rem 1.5rem; }
    .home-trust-item { padding: 0.875rem 1rem; font-size: 0.78rem; }
  }
`;