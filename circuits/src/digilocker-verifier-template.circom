pragma circom 2.1.9;

include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/poseidon.circom";
include "./helpers/constants.circom";
include "./helpers/signature.circom";
include "./helpers/nullifier.circom";
include "./helpers/extractor.circom";


/// @title DigiLockerVerifierTemplate
/// @notice This circuit verifies signed DigiLocker XML documents and reveals data
/// @param n RSA public key size per chunk
/// @param k Number of chunks the RSA public key is split into
/// @param maxDataLength Maximum length of the data
/// @input dataPadded C14N XML data (attribute-sorted) — used for SHA-256 verification
/// @input dataPaddedOriginal Original XML data (original attribute order) — used for field extraction
/// @input dataPaddedLength Length of padded data
/// @input signedInfo <SignedInfo> node
/// @input dataHashIndex Index of the digest in <SignedInfo>
/// @input certificateDataNodeIndex Index of <Certificate  in dataPaddedOriginal
/// @input documentTypeLength Length of document type field
/// @input precomputedSHA Precomputed SHA hash of dataPadded
/// @input signature RSA signature
/// @input pubKey RSA public key
/// @input isRevealEnabled Flag to enable reveal
/// @input revealStartIndex Start index of reveal data (relative to certificateDataNodeIndex)
/// @input revealEndIndex End index of reveal data
/// @input nullifierSeed Nullifier seed
/// @input signalHash Signal hash
/// @output pubkeyHash Public key hash
/// @output nullifier Computed nullifier
/// @output documentType Extracted document type
/// @output reveal Extracted reveal data
template DigiLockerVerifierTemplate(n, k, maxDataLength) {
  var signedInfoMaxLength = signedInfoMaxLength();

  // C14N sorted data — for SHA-256 verification against DigestValue
  signal input dataPadded[maxDataLength];
  signal input dataPaddedLength;

  // Original attribute order data — for field extraction
  signal input dataPaddedOriginal[maxDataLength];

  signal input signedInfo[signedInfoMaxLength];
  signal input dataHashIndex;
  signal input certificateDataNodeIndex;
  signal input documentTypeLength;
  signal input precomputedSHA[32];
  signal input signature[k];
  signal input pubKey[k];
  signal input isRevealEnabled;
  signal input revealStartIndex;
  signal input revealEndIndex;
  signal input nullifierSeed;
  signal input signalHash;

  signal output pubkeyHash;
  signal output nullifier;
  signal output documentType;
  signal output reveal;

  // Assert dataPaddedLength fits in maxDataLength
  component n2bDataLength = Num2Bits(log2Ceil(maxDataLength));
  n2bDataLength.in <== dataPaddedLength;

  // Assert data between dataPaddedLength and maxDataLength is zero (C14N data)
  AssertZeroPadding(maxDataLength)(dataPadded, dataPaddedLength);

  // Verify the RSA signature using C14N sorted dataPadded
  component signatureVerifier = SignatureVerifier(n, k, maxDataLength);
  signatureVerifier.dataPadded <== dataPadded;
  signatureVerifier.dataPaddedLength <== dataPaddedLength;
  signatureVerifier.signedInfo <== signedInfo;
  signatureVerifier.dataHashIndex <== dataHashIndex;
  signatureVerifier.pubKey <== pubKey;
  signatureVerifier.signature <== signature;
  signatureVerifier.precomputedSHA <== precomputedSHA;

  pubkeyHash <== signatureVerifier.pubkeyHash;

  // Extract and reveal using original attribute order data
  component extractor = Extractor(n, k, maxDataLength);
  extractor.dataPadded <== dataPaddedOriginal;
  extractor.certificateDataNodeIndex <== certificateDataNodeIndex;
  extractor.documentTypeLength <== documentTypeLength;
  extractor.isRevealEnabled <== isRevealEnabled;
  extractor.revealStartIndex <== revealStartIndex;
  extractor.revealEndIndex <== revealEndIndex;
  documentType <== extractor.documentType;
  reveal <== extractor.reveal;

  // Calculate nullifier
  nullifier <== Nullifier()(nullifierSeed, precomputedSHA);

  // Dummy square to prevent signal tampering
  signal signalHashSquare <== signalHash * signalHash;
}
