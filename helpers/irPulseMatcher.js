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

// Marks longer than this (in raw Broadlink units) are the protocol's "1" bit, shorter ones its
// "0" bit. Real captures of the same button jitter by a couple of units around roughly 20 and 55,
// so this sits far from both clusters and classification stays stable.
const LONG_MARK_THRESHOLD = 35;
const GAP_THRESHOLD = 100;
const GAP_QUANTISATION = 50;

// Reduces a pulse train to a jitter-tolerant symbol string. Comparing these is what makes
// matching reliable: averaging raw pulse differences cannot distinguish two codes that differ in
// only a handful of bits (e.g. "off" versus "heat 24"), because capture jitter is larger than the
// difference between the codes themselves.
const toSymbols = (pulses) => {
  if (!pulses || pulses.length === 0) {return null;}

  return pulses.map((pulse) => {
    // Headers and inter-frame gaps are hundreds of units long; quantise them coarsely so that
    // jitter doesn't change the symbol, but a genuinely different structure still does.
    if (pulse > GAP_THRESHOLD) {return `G${Math.round(pulse / GAP_QUANTISATION)}`;}

    return pulse >= LONG_MARK_THRESHOLD ? '1' : '0';
  }).join(',');
}

// Returns every candidate whose symbol string is exactly equal to the captured code's.
//
// Matching is deliberately exact rather than "closest": an approximate match on this kind of data
// is a coin flip between codes that mean very different things, and acting on the wrong one leaves
// HomeKit believing the unit is in a state it isn't (which later transmissions would then act on).
// Missing a press is safe; inventing the wrong one is not.
const findExactMatches = (hex, candidates) => {
  const symbols = toSymbols(decodePulses(hex));
  if (!symbols) {return [];}

  return candidates.filter((candidate) => candidate.symbols === symbols);
}

// A single IR waveform can legitimately carry more than one meaning - most AC remotes encode the
// whole unit state in every code, so e.g. the "on" code can be byte-identical to "cool 24 with
// fan 100", and "off" is often shared between heating and cooling. Rather than guessing between
// them, this keeps only the properties every match agrees on: identical "off" codes still switch
// the accessory off, while the mode/temperature they disagree about is simply left alone.
const consensusState = (matches) => {
  if (!matches || matches.length === 0) {return null;}

  const keys = new Set();
  matches.forEach(({ state }) => Object.keys(state || {}).forEach((key) => keys.add(key)));

  const consensus = {};
  keys.forEach((key) => {
    const value = (matches[0].state || {})[key];
    const unanimous = matches.every((match) => (match.state || {})[key] === value);

    if (unanimous && value !== undefined) {consensus[key] = value;}
  });

  return consensus;
}

module.exports = { decodePulses, toSymbols, findExactMatches, consensusState };
