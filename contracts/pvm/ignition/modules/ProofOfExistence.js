const { buildModule } = require("@nomicfoundation/hardhat-ignition/modules");

module.exports = buildModule("ProofOfExistence", (m) => {
  const poe = m.contract("ProofOfExistence");
  return { poe };
});
