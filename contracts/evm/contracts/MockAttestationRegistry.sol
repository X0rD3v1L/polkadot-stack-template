// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/// @title MockAttestationRegistry
/// @notice Local mock of Protocol Commons AttestationRegistry for testing
/// @dev On Paseo, use the real contract at 0x4d018c530e01bbc98b042a18a4d4090658bcd8f3
contract MockAttestationRegistry {

    struct AttestationRecord {
        bytes32 schema;
        address recipient;
        address attester;
        uint64 time;
        uint64 expirationTime;
        uint64 revocationTime;
        bytes32 refUID;
        bool revocable;
        bytes data;
    }

    mapping(bytes32 => AttestationRecord) private _attestations;
    // subject => schema => attester => valid
    mapping(address => mapping(bytes32 => mapping(address => bool))) private _valid;
    uint256 private _counter;

    event Attested(
        address indexed recipient,
        address indexed attester,
        bytes32 indexed schema,
        bytes32 uid
    );

    event Revoked(
        address indexed recipient,
        address indexed attester,
        bytes32 indexed schema,
        bytes32 uid
    );

    function attest(
        bytes32 schema,
        address recipient,
        uint64 expirationTime,
        bool revocable,
        bytes32 refUID,
        bytes calldata data
    ) external returns (bytes32 uid) {
        _counter++;
        uid = keccak256(abi.encodePacked(_counter, schema, recipient, msg.sender, block.timestamp));

        _attestations[uid] = AttestationRecord({
            schema: schema,
            recipient: recipient,
            attester: msg.sender,
            time: uint64(block.timestamp),
            expirationTime: expirationTime,
            revocationTime: 0,
            refUID: refUID,
            revocable: revocable,
            data: data
        });

        _valid[recipient][schema][msg.sender] = true;

        emit Attested(recipient, msg.sender, schema, uid);
        return uid;
    }

    function isValid(
        address subject,
        bytes32 schema,
        address attester
    ) external view returns (bool) {
        return _valid[subject][schema][attester];
    }

    function revoke(bytes32 uid) external {
        AttestationRecord storage att = _attestations[uid];
        require(att.attester == msg.sender, "Not attester");
        require(att.revocable, "Not revocable");
        att.revocationTime = uint64(block.timestamp);
        _valid[att.recipient][att.schema][msg.sender] = false;
        emit Revoked(att.recipient, msg.sender, att.schema, uid);
    }

    function getAttestation(bytes32 uid)
        external
        view
        returns (AttestationRecord memory)
    {
        return _attestations[uid];
    }
}
