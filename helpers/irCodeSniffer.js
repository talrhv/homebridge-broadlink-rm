const { getDevice } = require('./getDevice');

// Continuously listens for IR codes captured by a Broadlink device (e.g. a physical remote
// being pressed) and broadcasts each captured hex string to subscribed accessories. Unlike
// helpers/learnData.js (which captures exactly one code per "Learn" button press then tears
// itself down), this loop re-arms learning mode after every capture and keeps running for as
// long as at least one accessory is subscribed for that host.

const POLL_INTERVAL = 1500;
const RETRY_INTERVAL = 5000;
const REARM_AFTER_SEND_DELAY = 500;

// Accessories aren't required to set a per-accessory "host" - like sendData()/getDevice(),
// an accessory with no host configured falls back to "the single discovered device". All such
// accessories share one registry entry, keyed by this sentinel (getDevice() itself still
// receives the real, possibly-undefined host so its own fallback logic applies).
const DEFAULT_KEY = '__default__';
const registryKeyFor = (host) => host || DEFAULT_KEY;
const labelFor = (host) => host || 'the default Broadlink device';

const registry = {};

const subscribe = (host, log, logLevel, onCode) => {
  const key = registryKeyFor(host);

  let entry = registry[key];
  if (!entry) {
    entry = { host, subscribers: new Set(), device: null, onRawData: null, pollTimeout: null, retryTimeout: null, hasLoggedWaiting: false };
    registry[key] = entry;
  }

  entry.subscribers.add(onCode);

  if (!entry.device) {startLoop(key, log, logLevel);}
}

const unsubscribe = (host, onCode) => {
  const key = registryKeyFor(host);
  const entry = registry[key];
  if (!entry) {return;}

  entry.subscribers.delete(onCode);

  if (entry.subscribers.size === 0) {stopLoop(key);}
}

const startLoop = (key, log, logLevel) => {
  const entry = registry[key];
  if (!entry || entry.device) {return;}

  const device = getDevice({ host: entry.host, log, learnOnly: true });

  if (!device || !device.enterLearning) {
    if (!entry.hasLoggedWaiting) {
      entry.hasLoggedWaiting = true;
      if (logLevel <= 3) {log(`\x1b[33m[WARNING]\x1b[0m IR Code Sniffer (${labelFor(entry.host)}) device not yet discovered or doesn't support IR learning - will keep retrying every ${RETRY_INTERVAL / 1000}s.`);}
    }

    entry.retryTimeout = setTimeout(() => startLoop(key, log, logLevel), RETRY_INTERVAL);
    return;
  }

  entry.device = device;

  if (logLevel <= 2) {log(`\x1b[35m[INFO]\x1b[0m IR Code Sniffer (${labelFor(entry.host)}) now listening for physical remote-control codes.`);}

  entry.onRawData = (message) => {
    const hex = message.toString('hex');

    if (logLevel <= 2) {log(`\x1b[35m[INFO]\x1b[0m IR Code Sniffer (${labelFor(entry.host)}) captured hex: ${hex}`);}

    entry.subscribers.forEach((onCode) => {
      try {
        onCode(hex);
      } catch (err) {
        if (logLevel <= 4) {log(`\x1b[31m[ERROR]\x1b[0m IR Code Sniffer (${labelFor(entry.host)}) subscriber error: ${err.message}`);}
      }
    });

    // Re-arm immediately so the next remote button press is captured too.
    try {
      device.enterLearning();
    } catch (err) {
      if (logLevel <= 4) {log(`\x1b[31m[ERROR]\x1b[0m IR Code Sniffer (${labelFor(entry.host)}) failed to re-arm learning mode: ${err.message}`);}
    }
  };

  device.on('rawData', entry.onRawData);
  device.enterLearning();

  poll(key);
}

const poll = (key) => {
  const entry = registry[key];
  if (!entry || !entry.device) {return;}

  entry.pollTimeout = setTimeout(async () => {
    const current = registry[key];
    if (!current || !current.device) {return;}

    try {
      await current.device.mutex.use(async () => {
        // Only poll here - never re-arm on a timer. enterLearning() clears the device's capture
        // buffer, so calling it before each checkData() would wipe a code received from the
        // remote moments earlier and nothing would ever be captured. Learning mode is armed once
        // in startLoop() and re-armed in onRawData() after each successful capture.
        current.device.checkData();
      });
    } catch (err) {
      // A transient send/mutex hiccup must never permanently stop the passive listener - the
      // next tick will simply try again.
    }

    poll(key);
  }, POLL_INTERVAL);
}

// Called by helpers/sendData.js once a transmission has completed. Actually transmitting an
// IR/RF code takes the Broadlink device out of learning mode silently - with no error and no
// event - so any accessory listening on that same device would go permanently deaf after the
// first code the plugin sends. Re-arming here (rather than on the poll timer) is deliberate:
// enterLearning() clears the capture buffer, so it must only happen when no captured code
// could be waiting to be read.
const rearmAfterSend = (device, log, logLevel) => {
  if (!device) {return;}

  Object.keys(registry).forEach((key) => {
    const entry = registry[key];
    if (!entry || entry.device !== device) {return;}

    // Give the transmission a moment to finish before re-arming
    setTimeout(() => {
      const current = registry[key];
      if (!current || current.device !== device) {return;}

      try {
        device.enterLearning();

        if (logLevel <= 1) {log(`\x1b[34m[DEBUG]\x1b[0m IR Code Sniffer (${labelFor(current.host)}) re-armed learning mode after sending a code.`);}
      } catch (err) {
        if (logLevel <= 4) {log(`\x1b[31m[ERROR]\x1b[0m IR Code Sniffer (${labelFor(current.host)}) failed to re-arm learning mode after sending: ${err.message}`);}
      }
    }, REARM_AFTER_SEND_DELAY);
  });
}

const stopLoop = (key) => {
  const entry = registry[key];
  if (!entry) {return;}

  if (entry.pollTimeout) {clearTimeout(entry.pollTimeout);}
  if (entry.retryTimeout) {clearTimeout(entry.retryTimeout);}

  if (entry.device) {
    if (entry.onRawData) {entry.device.removeListener('rawData', entry.onRawData);}
    entry.device.cancelLearn();
  }

  delete registry[key];
}

module.exports = { subscribe, unsubscribe, rearmAfterSend };
