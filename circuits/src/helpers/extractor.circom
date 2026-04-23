pragma circom 2.1.9;

include "circomlib/circuits/comparators.circom";
include "@zk-email/circuits/utils/array.circom";
include "@zk-email/circuits/utils/bytes.circom";


/// @title Extractor
/// @notice Extracts document type and reveal data from the signed XML data
/// @dev Changed boundary tag from <CertificateData> (17 bytes) to <Certificate  (13 bytes)
///      This allows revealing attributes from the outer <Certificate> node
///      including number (PAN), name, type, status, issueDate etc.
/// @param n RSA public key size per chunk
/// @param k Number of chunks the RSA public key is split into
/// @param maxDataLength Maximum length of the data
template Extractor(n, k, maxDataLength) {
  signal input dataPadded[maxDataLength];
  signal input certificateDataNodeIndex;
  signal input documentTypeLength;
  signal input isRevealEnabled;
  signal input revealStartIndex;
  signal input revealEndIndex;

  signal output documentType;
  signal output reveal;

  // Shift left till "<Certificate " node (13 bytes)
  component certificateDataNodeShifter = VarShiftLeft(maxDataLength, maxDataLength);
  certificateDataNodeShifter.in <== dataPadded;
  certificateDataNodeShifter.shift <== certificateDataNodeIndex;
  signal shiftedData[maxDataLength] <== certificateDataNodeShifter.out;

  // Assert first 13 bytes are "<Certificate "
  // ASCII: < C  e  r  t  i  f  i  c  a  t  e  (space)
  //        60 67 101 114 116 105 102 105 99 97 116 101 32
  component certificateDataEquals[13];
  var certificateData[13] = [60, 67, 101, 114, 116, 105, 102, 105, 99, 97, 116, 101, 32];
  for (var i = 0; i < 13; i++) {
    certificateDataEquals[i] = IsEqual();
    certificateDataEquals[i].in <== [certificateData[i], shiftedData[i]];
    certificateDataEquals[i].out === 1;
  }

  // Extract the document type - starts from 14th byte after "<Certificate "
  component documentTypeSelector = SelectSubArray(maxDataLength, 32);
  documentTypeSelector.in <== shiftedData;
  documentTypeSelector.startIndex <== 13 + 1;
  documentTypeSelector.length <== documentTypeLength + 1;

  // Assert char after documentTypeLength is " " or ">"
  signal charAfterDocumentType <== ItemAtIndex(32)(documentTypeSelector.out, documentTypeLength);
  signal isSpace <== IsEqual()([charAfterDocumentType, 32]);
  signal isGreaterThan <== IsEqual()([charAfterDocumentType, 62]);
  (1 - isSpace) * (1 - isGreaterThan) === 0;

  // Pack documentType as a number (up to 31 bytes in a single field element)
  component documentTypePacker = PackByteSubArray(32, 31);
  documentTypePacker.in <== documentTypeSelector.out;
  documentTypePacker.startIndex <== 0;
  documentTypePacker.length <== documentTypeLength;
  documentType <== documentTypePacker.out[0];

  // Extract and pack the reveal bytes - max 31 bytes
  // revealStartIndex and revealEndIndex are relative to "<Certificate "
  component revealSelector = SelectSubArray(maxDataLength, 31);
  revealSelector.in <== shiftedData;
  revealSelector.startIndex <== revealStartIndex;
  revealSelector.length <== revealEndIndex - revealStartIndex + 1;

  component revealPacker = PackBytes(31);
  revealPacker.in <== revealSelector.out;
  reveal <== isRevealEnabled * revealPacker.out[0];
}