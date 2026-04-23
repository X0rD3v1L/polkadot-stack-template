//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.19;

import "./interfaces/IAnonDigiLockerGroth16Verifier.sol";
import "./interfaces/IAnonDigiLocker.sol";

contract AnonDigiLocker is IAnonDigiLocker {
  address public verifier;
  uint256 public immutable storedPublicKeyHash;
  mapping(uint256 => bool) public usedNullifiers;

  constructor(address _verifier, uint256 _pubkeyHash) {
    verifier = _verifier;
    storedPublicKeyHash = _pubkeyHash;
  }

  /// @dev View-only verify — does not mark nullifier as used (for checking)
  function verifyProofView(
    uint nullifierSeed,
    uint nullifier,
    uint documentType,
    uint reveal,
    uint signal,
    uint[8] calldata groth16Proof
  ) public view returns (bool) {
    uint signalHash = _hash(signal);
    return IAnonDigiLockerGroth16Verifier(verifier).verifyProof(
      [groth16Proof[0], groth16Proof[1]],
      [[groth16Proof[2], groth16Proof[3]], [groth16Proof[4], groth16Proof[5]]],
      [groth16Proof[6], groth16Proof[7]],
      [storedPublicKeyHash, nullifier, documentType, reveal, nullifierSeed, signalHash]
    );
  }

  /// @dev Full verify — marks nullifier as used to prevent reuse
  function verifyAnonDigiLockerProof(
    uint nullifierSeed,
    uint nullifier,
    uint documentType,
    uint reveal,
    uint signal,
    uint[8] calldata groth16Proof
  ) public returns (bool) {
    require(!usedNullifiers[nullifier], "Nullifier already used");
    uint signalHash = _hash(signal);
    bool valid = IAnonDigiLockerGroth16Verifier(verifier).verifyProof(
      [groth16Proof[0], groth16Proof[1]],
      [[groth16Proof[2], groth16Proof[3]], [groth16Proof[4], groth16Proof[5]]],
      [groth16Proof[6], groth16Proof[7]],
      [storedPublicKeyHash, nullifier, documentType, reveal, nullifierSeed, signalHash]
    );
    require(valid, "Invalid proof");
    usedNullifiers[nullifier] = true;
    return true;
  }

  function _hash(uint256 message) private pure returns (uint256) {
    return uint256(keccak256(abi.encodePacked(message))) >> 3;
  }
}