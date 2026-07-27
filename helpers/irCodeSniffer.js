const { getDevice } = require('./getDevice');

// Continuously listens for IR codes captured by a Broadlink device (e.g. a physical remote
// being pressed) and broadcasts each captured hex string to subscribed accessories. Unlike
// helpers/learnData.js (which captures exactly one code per "Learn" button press then tears
// itself down), this loop re-arms learning mode after every capture and keeps running for as
// long as at least one accessory is subscribed for that host.

const POLL_INTERVAL = 1500;
const RETRY_INTERVAL = 5000;

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
    device.enterLearning();
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

    await current.device.mutex.use(async () => {
      current.device.checkData();
    });

    poll(key);
  }, POLL_INTERVAL);
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

module.exports = { subscribe, unsubscribe };
