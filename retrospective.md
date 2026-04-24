# PBP Project Retrospective

---

**Your name:** Benarjee Sambangi

**Project name:** zkPAN

**Repo URL:** github.com/X0rD3v1L/polkadot-stack-template

**Path chosen:** 
Frontend: React + TypeScript
Contracts: Solidity on EVM

---

## What I built

ZK PAN Verifier generates a zero-knowledge proof from a user's PAN card XML downloaded from DigiLocker, allowing them to prove their identity without revealing any personal data. The attestation is issued through Protocol Commons AttestationRegistry on Paseo Asset Hub, so any app on the network can verify the credential without knowing anything about the holder

---

## Why I picked this path

I was already familiar with an existing ZK identity concept (anon-digilocker) from other chains, so I stuck with Solidity contracts on the EVM-compatible Polkadot Hub TestNet rather than exploring PVM or pallets. The .zkey and .wasm circuit artifacts are hosted on AWS S3 since they are too large to bundle with the frontend. For the frontend I used the polkadot-stack-template as a base and configured Polkadot Hub TestNet as a custom network in MetaMask.

---

## What worked

Deploying EVM contracts to Polkadot TestNet was straightforward, the tooling behaved exactly like any other EVM chain. The Protocol Commons documentation was clear enough to understand the AttestationRegistry structure and wire up the attestation flow without much friction.

---

## What broke

Still, I am not able to fix the wallet connect issue, I think the issue still exists with other wallets as well.

---

## What I'd do differently

I would research potential caveats upfront and think earlier about making the circuit generic enough to support other identity documents beyond PAN. I would also test against multiple versions of DigiLocker XML rather than a single fixture, and spend more time understanding the circuit design before implementation rather than debugging constraints mid-way through.

---

## Stack feedback for Parity

Large ZK circuits are hard to bring on-chain the proof generation takes 2–3 minutes in the browser and the circuit artifacts are too large to serve from the frontend. Better documentation or examples around deploying ZK verifiers would have saved significant time.
The AttestationRegistry has a genuinely clean interface. Any app can check any credential from any attester without knowing anything about the underlying proof system that composability is well designed and should not change.
The DotNS deployment system and its documentation were good. Better support or guidance for circuit DSLs beyond Circom would be a useful addition.

---

## Links

- **Bug reports filed:** N/A
- **PRs submitted to stack repos:** N/A
- **Pitch slides / presentation:**
[Slides](https://docs.google.com/presentation/d/1T_vdKjKa5yFkZWLyhTz_Ew5Ng--plZO7BYrzgyP4WDU/edit?usp=sharing)
- **Demo video (if any):** N/A
- **Live deployment (if any):**
[zkPAN](zk-pan-verifier00.dot.li/)
[zkPAN on  github pages](x0rd3v1l.github.io/polkadot-stack-template/)
- **Anything else worth sharing:** Nothing for now
