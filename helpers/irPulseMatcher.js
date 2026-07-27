// Decodes a Broadlink learned-IR hex string into its raw pulse-duration sequence (each unit is
// ~32.84us). Bytes 0x01-0xff encode a duration directly; 0x00 signals that the following two
// bytes (big-endian) hold a duration too long to fit in a single byte.
const decodePulses = (hexString) => {
  if (typeof hexString !== 'string') {return null;}

  let buffer;
  try {
    buffer = Buffer.from(hexString, 'hex');
  } catch (err) {
    return null;
  }

  if (buffer.length < 4) {return null;}

  const length = buffer.readUInt16LE(2);
  const pulses = [];
  let index = 4;
  const end = Math.min(4 + length, buffer.length);

  while (index < end) {
    if (buffer[index] === 0x00) {
      if (index + 2 >= buffer.length) {break;}

      pulses.push(buffer.readUInt16BE(index + 1));
      index += 3;
    } else {
      pulses.push(buffer[index]);
      index += 1;
    }
  }

  return pulses;
}

const MAX_PULSE_COUNT_DIFFERENCE = 3;
const MAX_AVERAGE_PULSE_DIFFERENCE = 6;

// A Broadlink device's raw IR capture is never byte-identical between two presses of the same
// remote button - the receiver's timing has a few units of jitter each time - so an exact hex
// match against a previously learned code essentially never succeeds. Instead, each candidate's
// pre-decoded pulse-duration sequence is compared against the freshly captured one (same pulse
// count, within a small average per-pulse tolerance) and the closest sufficiently-similar
// candidate wins.
//
// candidates: array of objects each carrying a pre-decoded `pulses` array (see decodePulses).
// Returns the closest matching candidate object, or null if none are close enough.
const findClosestMatch = (hex, candidates) => {
  const pulses = decodePulses(hex);
  if (!pulses || pulses.length === 0) {return null;}

  let best = null;
  let bestAverageDifference = Infinity;

  candidates.forEach((candidate) => {
    const candidatePulses = candidate.pulses;
    if (!candidatePulses || Math.abs(candidatePulses.length - pulses.length) > MAX_PULSE_COUNT_DIFFERENCE) {return;}

    const length = Math.min(candidatePulses.length, pulses.length);
    let totalDifference = 0;
    for (let i = 0; i < length; i++) {
      totalDifference += Math.abs(candidatePulses[i] - pulses[i]);
    }

    const averageDifference = totalDifference / length;
    if (averageDifference < bestAverageDifference) {
      bestAverageDifference = averageDifference;
      best = candidate;
    }
  });

  return (best && bestAverageDifference <= MAX_AVERAGE_PULSE_DIFFERENCE) ? best : null;
}

module.exports = { decodePulses, findClosestMatch };
