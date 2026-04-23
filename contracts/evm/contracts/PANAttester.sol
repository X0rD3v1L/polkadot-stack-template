// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/// @title PANAttester
/// @notice Verifies ZK PAN proofs and issues on-chain attestations
///         via Protocol Commons AttestationRegistry v1 on Paseo
///
/// v1 AttestationRegistry deployed at: 0x4d018c530e01bbc98b042a18a4d4090658bcd8f3
///
/// v1 API used:
///   attest(address subject, bytes32 schema, bytes32 value, uint64 expiry)
///   isValid(address subject, bytes32 schema, address attester) view returns (bool)

// ── Interfaces ────────────────────────────────────────────────────────────────

interface IAnonDigiLocker {
    function verifyProofView(
        uint nullifierSeed,
        uint nullifier,
        uint documentType,
        uint documentReveal,
        uint signal,
        uint[8] calldata groth16Proof
    ) external view returns (bool);
}

/// @dev Protocol Commons AttestationRegistry v1 interface
interface IAttestationRegistry {
    /// @notice Attest a claim about a subject
    /// @param subject  The address being attested about
    /// @param schema   Free-form bytes32 schema identifier (keccak256 of schema string)
    /// @param value    Arbitrary bytes32 value encoding the claim data
    /// @param expiry   Unix timestamp when attestation expires (0 = never)
    function attest(
        address subject,
        bytes32 schema,
        bytes32 value,
        uint64 expiry
    ) external;

    /// @notice Check if an attestation is valid (exists, not revoked, not expired)
    /// @param subject  The address to check
    /// @param schema   The schema identifier
    /// @param attester The address that issued the attestation
    function isValid(
        address subject,
        bytes32 schema,
        address attester
    ) external view returns (bool);

    /// @notice Check if any of the given attesters has a valid attestation
    function isValidAny(
        address subject,
        bytes32 schema,
        address[] calldata attesters
    ) external view returns (bool);
}

// ── Main Contract ─────────────────────────────────────────────────────────────

contract PANAttester {

    // ── State ─────────────────────────────────────────────────────────────────

    /// @notice ZK verifier contract (AnonDigiLocker)
    IAnonDigiLocker public immutable zkVerifier;

    /// @notice Protocol Commons AttestationRegistry v1 on Paseo
    IAttestationRegistry public immutable attestationRegistry;

    /// @notice Schema: keccak256("zk.pan.indian.national.v1")
    bytes32 public immutable SCHEMA;

    /// @notice Nullifier seed — must match frontend
    uint256 public immutable nullifierSeed;

    /// @notice Tracks used nullifiers to prevent double attestation
    mapping(uint256 => bool) public usedNullifiers;

    /// @notice Maps address to their attestation nullifier
    mapping(address => uint256) public addressToNullifier;

    // ── Events ────────────────────────────────────────────────────────────────

    event PANVerified(
        address indexed recipient,
        uint256 indexed nullifier,
        uint256 timestamp
    );

    // ── Constructor ───────────────────────────────────────────────────────────

    constructor(
        address _zkVerifier,
        address _attestationRegistry,
        uint256 _nullifierSeed
    ) {
        require(_zkVerifier != address(0), "Invalid verifier");
        require(_attestationRegistry != address(0), "Invalid registry");

        zkVerifier = IAnonDigiLocker(_zkVerifier);
        attestationRegistry = IAttestationRegistry(_attestationRegistry);
        nullifierSeed = _nullifierSeed;

        // Schema identifier — free-form bytes32 in v1
        SCHEMA = keccak256("zk.pan.indian.national.v1");
    }

    // ── Core Function ─────────────────────────────────────────────────────────

    /// @notice Verify a ZK PAN proof and issue an on-chain attestation
    /// @param nullifier    Unique identity hash (non-reversible)
    /// @param documentType Document type packed as field element
    /// @param reveal       Revealed data (PAN number packed)
    /// @param signal       Signal used when generating proof (typically 1)
    /// @param groth16Proof The 8-element Groth16 proof array
    function verifyAndAttest(
        uint256 nullifier,
        uint256 documentType,
        uint256 reveal,
        uint256 signal,
        uint256[8] calldata groth16Proof
    ) external {
        // ── 1. Check nullifier not already used ───────────────────────────────
        require(!usedNullifiers[nullifier], "PAN already attested: nullifier reused");

        // ── 2. Verify ZK proof ────────────────────────────────────────────────
        bool valid = zkVerifier.verifyProofView(
            nullifierSeed,
            nullifier,
            documentType,
            reveal,
            signal,
            groth16Proof
        );
        require(valid, "Invalid ZK proof");

        // ── 3. Mark nullifier as used ─────────────────────────────────────────
        usedNullifiers[nullifier] = true;
        addressToNullifier[msg.sender] = nullifier;

        // ── 4. Issue attestation via v1 AttestationRegistry ───────────────────
        // value = bytes32(nullifier) encodes the opaque identity
        // expiry = 0 means never expires
        attestationRegistry.attest(
            msg.sender,           // subject = wallet submitting the proof
            SCHEMA,               // schema = keccak256("zk.pan.indian.national.v1")
            bytes32(nullifier),   // value = nullifier as opaque identity proof
            0                     // expiry = never
        );

        emit PANVerified(msg.sender, nullifier, block.timestamp);
    }

    // ── View Functions ────────────────────────────────────────────────────────

    /// @notice Check if an address has a valid PAN attestation
    function hasValidAttestation(address user) external view returns (bool) {
        return attestationRegistry.isValid(user, SCHEMA, address(this));
    }

    /// @notice Check if a nullifier has already been used
    function isNullifierUsed(uint256 nullifier) external view returns (bool) {
        return usedNullifiers[nullifier];
    }

    /// @notice Get nullifier for an address (0 if not attested)
    function getNullifierByAddress(address user) external view returns (uint256) {
        return addressToNullifier[user];
    }
}
