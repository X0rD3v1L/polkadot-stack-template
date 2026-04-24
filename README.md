# ZK PAN Verifier

Prove you hold a valid Indian PAN card without revealing your name, date of birth, or any other personal data. A zero-knowledge Groth16 proof generated entirely in your browser is verified on-chain via a smart contract on Paseo Asset Hub and issued as a credential through Protocol Commons.

**Frontend**: React + TypeScript (Vite, xmldsigjs, snarkjs)  
**Contracts**: Solidity on EVM 
**Live**: https://zk-pan-verifier00.dot.li

The idea is inspired from anon-digilocker [github.com/anon-aadhaar/anon-digilocker](https://github.com/anon-aadhaar/anon-digilocker)

---

## How It Works

1. **Download** your PAN XML from DigiLocker (Issued Documents → PAN Card → Download XML).
2. **Upload** the XML to the Generate page. Fields are shown locally — name and date of birth are blurred by default and revealed only on hover.
3. **Prove**: snarkjs runs a Groth16 prover in the browser (~2–3 minutes). The XML never leaves your device.
4. **Submit**: PANAttester verifies the proof on-chain, marks the nullifier used, and calls `attest()` on the Protocol Commons AttestationRegistry.
5. **Verify**: any app can call `AttestationRegistry.isValid(wallet, schema, PANAttester)` to confirm the credential without learning anything about the holder.
6. **Claim discount**: connect the same wallet to the India Summit event page. Attestation is checked live on-chain and 50% off unlocks instantly — no codes, no KYC.

---

## Paseo Contracts

| Contract            | Address                                      |
| ------------------- | -------------------------------------------- |
| Verifier            | `0x006d6dcc857c13ee747b2b8981f8bcded885e927` |
| AnonDigiLocker      | `0xc3411536e1139de3df14e68b2538ab456ba58702` |
| PANAttester         | `0xadeeaa7a41ef851a1edc691b5e399305bdff77e4` |
| AttestationRegistry | `0x4d018c530e01bbc98b042a18a4d4090658bcd8f3` |

**Network**: Paseo Asset Hub · Chain ID `420420417`  
**RPC**: `https://services.polkadothub-rpc.com/testnet`  
**Explorer**: [blockscout-testnet.polkadot.io](https://blockscout-testnet.polkadot.io)

---

## Run Locally

```bash
cd web && npm install && npm run dev
```

Deploy contracts to Paseo:

```bash
cd contracts/evm
npx hardhat vars set PRIVATE_KEY
npm run deploy:testnet
```

---

## Circuit Architecture

The circuit takes two data streams to solve the C14N attribute-ordering problem:

| Signal               | Source                    | Purpose                                  |
| -------------------- | ------------------------- | ---------------------------------------- |
| `dataPadded`         | xmldsigjs exclusive C14N  | SHA-256 verification against DigestValue |
| `dataPaddedOriginal` | Raw original order        | PAN number field extraction              |

`dataPadded` is fed to the SHA-256 partial hasher and checked against the `DigestValue` in `SignedInfo`. `dataPaddedOriginal` is used by the extractor circuit to locate and reveal the PAN number — because the original attribute order is what the field indices were compiled for.

The circuit was compiled with:

```
DigiLockerVerifierTemplate(121, 17, 512*3)
  — n=121 bits per RSA chunk
  — k=17 chunks (RSA-2048)
  — maxDataLength=1536 bytes
```

---

## Public Signals

| Index | Signal          | What it encodes                                                  |
| ----- | --------------- | ---------------------------------------------------------------- |
| `[0]` | `pubkeyHash`    | Poseidon hash of UIDAI's RSA-2048 key — contract checks this    |
| `[1]` | `nullifier`     | `Poseidon(nullifierSeed, precomputedSHA)` — one per PAN per app |
| `[2]` | `documentType`  | Document type bytes packed as field element                      |
| `[3]` | `reveal`        | PAN number packed as bytes, LSB-first                           |
| `[4]` | `nullifierSeed` | `123456789` — scopes nullifier to this application              |
| `[5]` | `signalHash`    | `keccak256(abi.encodePacked(signal)) >> 3`                       |

---

## Features

- Full end-to-end flow on Paseo: generate proof → submit → check attestation
- Dual-stream circuit input generation in the browser via xmldsigjs
- RSA modulus extracted directly from X.509 DER without SubtleCrypto
- Blurred field UX — name and DOB hidden until hover, PAN always visible
- ZK-gated event discount demo (`IndiaEventPage.tsx`) reads attestation live on-chain
- Frontend hosted on IPFS, domain registered via Polkadot naming system (DotNS)

## Known Caveats

**Synthetic testing only**: All testing used a single XML fixture. Proper thorough testing with all versions of XML signed by UIDAI needs to be done.

---

## Issues Faced

**The C14N problem consumed most of the implementation time.** DigiLocker signs the XML using exclusive C14N canonicalization (RFC 3076), which sorts attributes alphabetically, expands self-closing tags, and propagates namespace declarations. Python's `lxml` handles this correctly. The browser's `XMLSerializer` does not — it preserves original attribute order and omits namespace propagation, producing a different SHA-256 digest and causing the circuit's constraint at `SignatureVerifier line: 55` to fail. The fix was to run the XML through `xmldsigjs`'s `ApplyTransforms`, which processes the `Reference` transforms exactly as the signer did and produces byte-identical output to `lxml`. The original attribute order is preserved separately in `dataPaddedOriginal` for field extraction — hence the dual-stream design.

---

## References

**anon-aadhaar/anon-digilocker**: [github.com/anon-aadhaar/anon-digilocker](https://github.com/anon-aadhaar/anon-digilocker)