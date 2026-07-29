const os = require('os');
const path = require('path');
const { expect } = require('chai');

const { setup } = require('./helpers/setup');
const { buildIRHex, jitter } = require('./helpers/irHex');
const HeaterCooler = require('../accessories/heater-cooler');

// The platform initialises node-persist on construction; keep it out of the real homebridge dir
const { device } = setup({ homebridgeDirectory: path.join(os.tmpdir(), 'homebridge-broadlink-rm-test') });

// Distinct, well-separated (pairwise average pulse difference >= 12) synthetic pulse patterns -
// real IR captures of different remote buttons look like this: same overall structure, very
// different bit content. Learned/matched hex is built from these; "captured" hex used in
// assertions applies jitter() to simulate the receiver's natural timing noise.
const COOL_ON_PULSES         = [54,54,54,20,20,54,54,54,54,54,20,54,20,54,54,54,54,54,20,54,54,20,20,20,20,20,20,54,54,20,54,20];
const COOL_OFF_PULSES        = [54,20,20,54,20,20,20,54,54,54,54,20,20,20,54,54,54,20,20,54,54,54,20,20,54,20,20,54,20,20,20,20];
const COOL_24_PULSES         = [54,54,54,20,20,54,20,20,54,20,54,20,54,54,54,20,20,20,20,20,20,20,20,20,20,54,54,54,54,54,54,54];
const COOL_26_SWING_ON_PULSES  = [54,54,54,20,20,54,54,20,54,54,54,54,54,20,54,20,54,54,54,20,20,20,54,20,54,54,20,20,20,54,54,20];
const COOL_26_SWING_OFF_PULSES = [54,20,54,54,20,20,20,54,54,54,54,54,54,54,20,54,20,54,20,20,20,54,20,54,20,20,54,20,54,54,20,20];
const HEAT_ON_PULSES         = [54,54,54,20,54,20,20,54,20,54,20,20,54,20,54,20,54,54,54,54,54,54,20,54,20,54,20,20,20,54,20,54];
const HEAT_OFF_PULSES        = [20,20,54,20,20,54,54,54,54,54,20,20,54,54,20,20,54,20,54,20,54,20,20,20,20,54,54,20,54,54,20,20];
const HEAT_20_PULSES         = [20,54,54,20,20,20,20,54,20,20,54,20,20,20,54,54,20,54,54,20,20,20,20,54,54,20,54,20,54,20,54,54];

const config = {
  name: 'AC',
  type: 'heater-cooler',
  host: device.host.address,
  persistState: false,
  noHistory: true,
  isUnitTest: true,
  logLevel: 'none',
  temperatureUnits: 'C',
  coolingThresholdTemperature: 24,
  heatingThresholdTemperature: 20,
  minTemperature: 16,
  maxTemperature: 30,
  data: {
    cool: {
      on: buildIRHex(COOL_ON_PULSES),
      off: buildIRHex(COOL_OFF_PULSES),
      temperatureCodes: {
        24: buildIRHex(COOL_24_PULSES),
        26: {
          swingOn: buildIRHex(COOL_26_SWING_ON_PULSES),
          swingOff: buildIRHex(COOL_26_SWING_OFF_PULSES)
        }
      }
    },
    heat: {
      on: buildIRHex(HEAT_ON_PULSES),
      off: buildIRHex(HEAT_OFF_PULSES),
      temperatureCodes: {
        20: buildIRHex(HEAT_20_PULSES)
      }
    }
  }
};

const newAccessory = (overrides) => new HeaterCooler(
  null,
  Object.assign(JSON.parse(JSON.stringify(config)), overrides),
  'FakeServiceManager'
);

describe('heaterCooler passive remote-control detection', () => {
  it('reports ACTIVE + mode + temperature from a known temperature hex code, without sending anything', () => {
    const accessory = newAccessory();
    accessory.irCodeCandidates = accessory.buildIRCodeCandidates();
    device.resetSentHexCodes();

    accessory.handleExternalIRCode(buildIRHex(jitter(COOL_24_PULSES)));

    expect(accessory.state.active).to.equal(Characteristic.Active.ACTIVE);
    expect(accessory.state.targetHeaterCoolerState).to.equal(Characteristic.TargetHeaterCoolerState.COOL);
    expect(accessory.state.coolingThresholdTemperature).to.equal(24);
    expect(device.getSentHexCodeCount()).to.equal(0);
  });

  it('reports INACTIVE from the "off" hex code, without sending anything', () => {
    const accessory = newAccessory();
    accessory.state.active = Characteristic.Active.ACTIVE;
    accessory.irCodeCandidates = accessory.buildIRCodeCandidates();
    device.resetSentHexCodes();

    accessory.handleExternalIRCode(buildIRHex(jitter(COOL_OFF_PULSES)));

    expect(accessory.state.active).to.equal(Characteristic.Active.INACTIVE);
    expect(device.getSentHexCodeCount()).to.equal(0);
  });

  it('resolves swingMode from a nested temperature/swing hex code', () => {
    const accessory = newAccessory();
    accessory.irCodeCandidates = accessory.buildIRCodeCandidates();
    device.resetSentHexCodes();

    accessory.handleExternalIRCode(buildIRHex(jitter(COOL_26_SWING_ON_PULSES)));

    expect(accessory.state.targetHeaterCoolerState).to.equal(Characteristic.TargetHeaterCoolerState.COOL);
    expect(accessory.state.coolingThresholdTemperature).to.equal(26);
    expect(accessory.state.swingMode).to.equal(Characteristic.SwingMode.SWING_ENABLED);
    expect(device.getSentHexCodeCount()).to.equal(0);
  });

  it('resolves heat mode temperature codes independently from cool', () => {
    const accessory = newAccessory();
    accessory.irCodeCandidates = accessory.buildIRCodeCandidates();
    device.resetSentHexCodes();

    accessory.handleExternalIRCode(buildIRHex(jitter(HEAT_20_PULSES)));

    expect(accessory.state.targetHeaterCoolerState).to.equal(Characteristic.TargetHeaterCoolerState.HEAT);
    expect(accessory.state.heatingThresholdTemperature).to.equal(20);
    expect(device.getSentHexCodeCount()).to.equal(0);
  });

  // A near-miss must be ignored outright rather than resolved to the closest code. Real AC codes
  // for different modes/temperatures differ by only a handful of bits, so "closest wins" matching
  // reliably picks the wrong one - which left HomeKit reporting a unit as heating when it had
  // actually been switched off.
  it('ignores a code that is close to, but not exactly, a known code', () => {
    const accessory = newAccessory();
    accessory.irCodeCandidates = accessory.buildIRCodeCandidates();
    device.resetSentHexCodes();

    const previousActive = accessory.state.active;
    const previousMode = accessory.state.targetHeaterCoolerState;
    const previousTemperature = accessory.state.heatingThresholdTemperature;

    // Same length and structure as HEAT_20, differing in a single bit
    const nearMiss = HEAT_20_PULSES.slice();
    nearMiss[5] = nearMiss[5] === 54 ? 20 : 54;

    accessory.handleExternalIRCode(buildIRHex(nearMiss));

    expect(accessory.state.active).to.equal(previousActive);
    expect(accessory.state.targetHeaterCoolerState).to.equal(previousMode);
    expect(accessory.state.heatingThresholdTemperature).to.equal(previousTemperature);
    expect(device.getSentHexCodeCount()).to.equal(0);
  });

  // Most AC remotes encode the whole unit state in every code, so one waveform can legitimately
  // mean several things (here: "turn on" is byte-identical to "cool 24, fan 100"). Guessing between
  // them is what invented state the unit was never in, so only the agreed-on parts are applied.
  it('applies only the agreed-on state when one code has several meanings', () => {
    const accessory = newAccessory({
      data: {
        cool: {
          on: buildIRHex(COOL_24_PULSES),   // identical to the "cool 24" temperature code
          off: buildIRHex(COOL_OFF_PULSES),
          temperatureCodes: { 24: buildIRHex(COOL_24_PULSES) }
        }
      }
    });
    accessory.irCodeCandidates = accessory.buildIRCodeCandidates();
    accessory.state.coolingThresholdTemperature = 19;
    device.resetSentHexCodes();

    accessory.handleExternalIRCode(buildIRHex(jitter(COOL_24_PULSES)));

    // Both meanings agree the unit is on and cooling, so that much is applied...
    expect(accessory.state.active).to.equal(Characteristic.Active.ACTIVE);
    expect(accessory.state.targetHeaterCoolerState).to.equal(Characteristic.TargetHeaterCoolerState.COOL);
    // ...but they disagree about temperature, so it must be left untouched rather than guessed
    expect(accessory.state.coolingThresholdTemperature).to.equal(19);
    expect(device.getSentHexCodeCount()).to.equal(0);
  });

  // Regression: the air-conditioner physically switched itself on while nobody was home. A code
  // detected from the remote left this believing the unit was running; a later threshold write from
  // a HomeKit automation then hit the mode-switch in setTemperature, which transmits - turning the
  // unit on. Passively observed state must never be able to initiate a transmission.
  it('does not transmit when a threshold changes after on/off was only detected from the remote', async () => {
    const accessory = newAccessory();
    accessory.irCodeCandidates = accessory.buildIRCodeCandidates();

    // The remote turned the unit on in cool mode
    accessory.handleExternalIRCode(buildIRHex(jitter(COOL_24_PULSES)));
    expect(accessory.state.active).to.equal(Characteristic.Active.ACTIVE);

    device.resetSentHexCodes();

    // An unattended automation now writes the *heating* threshold while the mode says cool
    await accessory.serviceManager.setCharacteristic(Characteristic.HeatingThresholdTemperature, 24);

    expect(device.getSentHexCodeCount()).to.equal(0);
    expect(accessory.state.targetHeaterCoolerState).to.equal(Characteristic.TargetHeaterCoolerState.COOL);
  });

  it('still switches mode on a threshold change once HomeKit has confirmed the unit is on', async () => {
    const accessory = newAccessory();
    accessory.irCodeCandidates = accessory.buildIRCodeCandidates();

    accessory.handleExternalIRCode(buildIRHex(jitter(COOL_24_PULSES)));

    // HomeKit itself turns the unit on, so its state is no longer merely observed
    await accessory.serviceManager.setCharacteristic(Characteristic.Active, Characteristic.Active.ACTIVE);
    device.resetSentHexCodes();

    // A genuine change of value (the configured default is 20), so the mode switch should happen
    await accessory.serviceManager.setCharacteristic(Characteristic.HeatingThresholdTemperature, 25);

    expect(accessory.state.targetHeaterCoolerState).to.equal(Characteristic.TargetHeaterCoolerState.HEAT);
    expect(device.getSentHexCodeCount()).to.be.greaterThan(0);
  });

  it('treats a power reading as confirmation of the on/off state', () => {
    const accessory = newAccessory({
      mqttURL: 'mqtt://localhost',
      mqttTopic: [{ identifier: 'power', topic: 'plug/energy' }]
    });
    accessory.irCodeCandidates = accessory.buildIRCodeCandidates();

    accessory.handleExternalIRCode(buildIRHex(jitter(COOL_24_PULSES)));
    expect(accessory.hasUnconfirmedPassiveState).to.equal(true);

    accessory.onMQTTMessage('power', Buffer.from('850'));

    expect(accessory.hasUnconfirmedPassiveState).to.equal(false);
  });

  it('ignores an unrecognised hex code', () => {
    const accessory = newAccessory();
    accessory.irCodeCandidates = accessory.buildIRCodeCandidates();

    const previousActive = accessory.state.active;
    device.resetSentHexCodes();

    // Different length entirely - guaranteed to fall outside the pulse-count tolerance
    accessory.handleExternalIRCode(buildIRHex([20, 54, 20, 54, 20, 54, 20, 54]));

    expect(accessory.state.active).to.equal(previousActive);
    expect(device.getSentHexCodeCount()).to.equal(0);
  });
});
