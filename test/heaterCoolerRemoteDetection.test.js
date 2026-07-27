const os = require('os');
const path = require('path');
const { expect } = require('chai');

const { setup } = require('./helpers/setup');
const HeaterCooler = require('../accessories/heater-cooler');

// The platform initialises node-persist on construction; keep it out of the real homebridge dir
const { device } = setup({ homebridgeDirectory: path.join(os.tmpdir(), 'homebridge-broadlink-rm-test') });

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
      on: 'COOL_ON',
      off: 'COOL_OFF',
      temperatureCodes: {
        24: 'COOL_24',
        26: {
          swingOn: 'COOL_26_SWING_ON',
          swingOff: 'COOL_26_SWING_OFF'
        }
      }
    },
    heat: {
      on: 'HEAT_ON',
      off: 'HEAT_OFF',
      temperatureCodes: {
        20: 'HEAT_20'
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
    accessory.hexReverseMap = accessory.buildHexReverseMap();
    device.resetSentHexCodes();

    accessory.handleExternalIRCode('COOL_24');

    expect(accessory.state.active).to.equal(Characteristic.Active.ACTIVE);
    expect(accessory.state.targetHeaterCoolerState).to.equal(Characteristic.TargetHeaterCoolerState.COOL);
    expect(accessory.state.coolingThresholdTemperature).to.equal(24);
    expect(device.getSentHexCodeCount()).to.equal(0);
  });

  it('reports INACTIVE from the "off" hex code, without sending anything', () => {
    const accessory = newAccessory();
    accessory.state.active = Characteristic.Active.ACTIVE;
    accessory.hexReverseMap = accessory.buildHexReverseMap();
    device.resetSentHexCodes();

    accessory.handleExternalIRCode('COOL_OFF');

    expect(accessory.state.active).to.equal(Characteristic.Active.INACTIVE);
    expect(device.getSentHexCodeCount()).to.equal(0);
  });

  it('resolves swingMode from a nested temperature/swing hex code', () => {
    const accessory = newAccessory();
    accessory.hexReverseMap = accessory.buildHexReverseMap();
    device.resetSentHexCodes();

    accessory.handleExternalIRCode('COOL_26_SWING_ON');

    expect(accessory.state.targetHeaterCoolerState).to.equal(Characteristic.TargetHeaterCoolerState.COOL);
    expect(accessory.state.coolingThresholdTemperature).to.equal(26);
    expect(accessory.state.swingMode).to.equal(Characteristic.SwingMode.SWING_ENABLED);
    expect(device.getSentHexCodeCount()).to.equal(0);
  });

  it('resolves heat mode temperature codes independently from cool', () => {
    const accessory = newAccessory();
    accessory.hexReverseMap = accessory.buildHexReverseMap();
    device.resetSentHexCodes();

    accessory.handleExternalIRCode('HEAT_20');

    expect(accessory.state.targetHeaterCoolerState).to.equal(Characteristic.TargetHeaterCoolerState.HEAT);
    expect(accessory.state.heatingThresholdTemperature).to.equal(20);
    expect(device.getSentHexCodeCount()).to.equal(0);
  });

  it('ignores an unrecognised hex code', () => {
    const accessory = newAccessory();
    accessory.hexReverseMap = accessory.buildHexReverseMap();

    const previousActive = accessory.state.active;
    device.resetSentHexCodes();

    accessory.handleExternalIRCode('SOME_UNKNOWN_HEX');

    expect(accessory.state.active).to.equal(previousActive);
    expect(device.getSentHexCodeCount()).to.equal(0);
  });
});
