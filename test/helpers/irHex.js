// Builds a minimal but structurally valid Broadlink learned-IR hex string from a plain array of
// single-byte pulse-duration values, for exercising helpers/irPulseMatcher.js in tests without
// needing real hardware-captured data.
const buildIRHex = (pulseValues) => {
  const header = Buffer.from([0x26, 0x00, pulseValues.length & 0xff, (pulseValues.length >> 8) & 0xff]);
  const pulseBuffer = Buffer.from(pulseValues);
  const terminator = Buffer.from([0x0d, 0x05, 0x00, 0x00, 0x00, 0x00]);

  return Buffer.concat([header, pulseBuffer, terminator]).toString('hex');
}

// Simulates the small receiver jitter real IR captures always have between two presses of the
// same remote button, by nudging each pulse value by a small cyclic offset.
const jitter = (pulseValues, deltas = [1, -1, 0, 2, -2, 0, 1, -1]) =>
  pulseValues.map((value, index) => value + deltas[index % deltas.length]);

module.exports = { buildIRHex, jitter };
