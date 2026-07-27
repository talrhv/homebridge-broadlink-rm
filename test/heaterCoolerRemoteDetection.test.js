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
