# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`homebridge-broadlink-rm-pro` is a Homebridge platform plugin that exposes Broadlink RM (Mini, Pro, RM4) IR/RF blasters to Apple HomeKit. Each entry in the user's config becomes a HomeKit accessory (switch, TV, air-conditioner/thermostat, fan, etc.) that translates HomeKit characteristic changes into learned IR/RF hex codes sent over the LAN to a Broadlink device.

## Commands

```bash
npm install          # install deps (required before running tests — node_modules is gitignored)
npm run lint         # eslint . — this is the ONLY check CI runs (.github/workflows/pipeline.yml)
npm run lint-fix     # eslint --fix .

npx mocha                        # run the full suite (mocha's default glob picks up test/*.js)
npx mocha test/switch.test.js    # run a single test file
npx mocha --grep "turns on"      # run tests matching a description
```

There is **no `test` npm script** — invoke `mocha` directly. CI only lints; it does not run the mocha suite, so run tests locally when changing accessory behaviour.

Node `>=7.6.0` is required (async/await); the base platform hard-throws below that.

## Architecture

### Registration & platform bootstrap
- `index.js` registers the platform and stashes `homebridge.hap.Service` / `Characteristic` as **globals** (`global.Service`, `global.Characteristic`). Accessory code references bare `Service` / `Characteristic` everywhere — they are never imported. This is why constructors read `Characteristic.*` lazily at runtime rather than at module top-level (see the comment in `accessories/aircon.js`).
- `base/platform.js` (`HomebridgePlatform`) is a generic Homebridge helper: parses `logLevel` into a numeric threshold and calls the subclass's `addAccessories`.
- `platform.js` (`BroadlinkRMPlatform`) extends it. `classTypes` maps each config `type` string to an accessory class. `addAccessories` instantiates one class per config entry, auto-injects the "Learn"/"Scan Frequency" accessories unless hidden, and **publishes TVs as external accessories** (a HomeKit limitation — TVs must be added separately in the Home app with the same PIN).

### Device discovery
- `helpers/getDevice.js` owns the device registry (`discoveredDevices`), keyed by both IP and MAC. Automatic discovery broadcasts via `helpers/broadlink.js` (`kiwicam-broadlinkjs-rm`); or the user sets `hosts` in config for manual devices. Each device gets a `Mutex` (from `await-semaphore`) plus background `startPing` (reachability) and `startKeepAlive` (UDP heartbeat).
- Manual device wiring in `platform.js#discoverBroadlinkDevices` has **firmware-specific workarounds** — read the inline comments before touching `deviceType` math or MAC handling. RM4 Pro validates deviceType (`0x2227`→`0x520b` swap) and MAC bytes (MAC must be passed as a Buffer, not a string) or it silently drops packets.

### Accessory class hierarchy (three layers)
1. `base/accessory.js` (`HomebridgeAccessory`) — generic HomeKit lifecycle: `setCharacteristicValue`/`getCharacteristicValue`, state persistence, MQTT subscription, and `getServices`. State is stored in `this.state`, wrapped in a **save-on-write Proxy** (`addSaveProxy`) so any mutation persists to disk via `helpers/persistentState` (node-persist).
2. `accessories/accessory.js` (`BroadlinkRMAccessory`) — adds Broadlink specifics: `logLevel` string→number mapping, MAC normalization, and IR/RF sending. `performSend` / `performRepeatSend` handle hex arrays with `sendCount`, `interval`, and `pause` for multi-code sequences.
3. `accessories/*.js` — one file per HomeKit device type. These override `setupServiceManager`, `setDefaults`, `correctReloadedState`, etc. `aircon.js` and `heater-cooler.js` are the most complex (temperature monitoring, heating/cooling state machines, fakegato history).

### ServiceManager — the characteristic wiring layer
`helpers/serviceManager.js` wraps a HAP `Service` and is how accessories bind HomeKit characteristics to their get/set handlers (`addToggleCharacteristic`, `addGetCharacteristic`, etc.). `helpers/serviceManagerTypes.js` holds reusable characteristic configs. The `serviceManagerType` constructor arg selects the real `ServiceManager` in production vs. `test/helpers/fakeServiceManager.js` (`'FakeServiceManager'`) in tests — this is the seam that makes accessories unit-testable without HomeKit.

### Sending codes
`helpers/sendData.js` is the single send path: detects Pronto codes (prefix `0000`) and converts them (`convertProntoCode.js`), looks up the device, then sends the hex buffer **inside the device mutex** so concurrent accessories don't interleave packets. Learning codes lives in `helpers/learnData.js` (IR) and `helpers/learnRFData.js` (RF), driven by the `learn-code`/`learn-ir` accessory.

## Testing model

Tests (`test/*.test.js`, mocha + chai) exercise accessories against fakes, no hardware:
- `test/helpers/setup.js` — `setup()` builds a `BroadlinkRMPlatform` with a `FakeDevice` and registers it; sets `global.Service`/`Characteristic` from `hap-nodejs`.
- `test/helpers/fakeDevice.js` — records sent hex; assert with `device.hasSentCode('ON')`, `device.getSentHexCodeCount()`, `device.hasSentCodes([...])`.
- Instantiate an accessory with `new Switch(null, config, 'FakeServiceManager')`, drive it via `accessory.serviceManager.setCharacteristic(Characteristic.On, true)`, then assert on `accessory.state.*` and the fake device's recorded codes.
- Use `persistState: false` in test config to avoid writing to disk.

## Conventions

- **Log levels are numeric thresholds**, not booleans. `logLevel` config strings (`trace`/`debug`/`info`/`warning`/`error`/`critical`/`none`) map to `0..6`; code guards with `if (this.logLevel <= N)`. Log lines embed raw ANSI color escapes (`\x1b[31m…\x1b[0m`) — match the surrounding style.
- **Config validation is strict and fatal**: `base/accessory.js#checkConfig` calls `process.exit(0)` when it detects a boolean or number that was quoted as a string in JSON. Preserve this when adding config options.
- The published npm package is `homebridge-broadlink-rm-pro` but the platform identifier registered with Homebridge is `"BroadlinkRM"` (see `index.js`). Config samples live in `config-sample.json`.
- User-facing docs are external (https://broadlink.kiwicam.nz); `docs/` only holds a few deep-dives (e.g. `heater-cooler.md`).
