const os = require('os');
const path = require('path');
const { expect } = require('chai');

const { setup } = require('./helpers/setup');
const { buildIRHex } = require('./helpers/irHex');
const delayForDuration = require('../helpers/delayForDuration');
const HeaterCooler = require('../accessories/heater-cooler');

// The platform initialises node-persist on construction; keep it out of the real homebridge dir
const { device } = setup({ homebridgeDirectory: path.join(os.tmpdir(), 'homebridge-broadlink-rm-test') });

// Distinct synthetic pulse patterns (see heaterCoolerRemoteDetection.test.js)
const COOL_ON_PULSES  = [54,54,54,20,20,54,54,54,54,54,20,54,20,54,54,54,54,54,20,54,54,20,20,20,20,20,20,54,54,20,54,20];
const OFF_PULSES      = [54,20,20,54,20,20,20,54,54,54,54,20,20,20,54,54,54,20,20,54,54,54,20,20,54,20,20,54,20,20,20,20];
const COOL_24_PULSES  = [54,54,54,20,20,54,20,20,54,20,54,20,54,54,54,20,20,20,20,20,20,20,20,20,20,54,54,54,54,54,54,54];
const HEAT_ON_PULSES  = [54,54,54,20,54,20,20,54,20,54,20,20,54,20,54,20,54,54,54,54,54,54,20,54,20,54,20,20,20,54,20,54];
const HEAT_24_PULSES  = [20,54,54,20,20,20,20,54,20,20,54,20,20,20,54,54,20,54,54,20,20,20,20,54,54,20,54,20,54,20,54,54];

const HEAT_24_HEX = buildIRHex(HEAT_24_PULSES);
const COOL_24_HEX = buildIRHex(COOL_24_PULSES);

const config = {
  name: 'AC',
  type: 'heater-cooler',
  host: device.host.address,
  persistState: false,
  noHistory: true,
  isUnitTest: true,
  logLevel: 'none',
  turnOnWhenOff: false,
  temperatureUnits: 'C',
  coolingThresholdTemperature: 24,
  heatingThresholdTemperature: 24,
  minTemperature: 16,
  maxTemperature: 30,
  data: {
    cool: {
      on: buildIRHex(COOL_ON_PULSES),
      off: buildIRHex(OFF_PULSES),
      temperatureCodes: { 24: COOL_24_HEX }
    },
    heat: {
      on: buildIRHex(HEAT_ON_PULSES),
      off: buildIRHex(OFF_PULSES),
      temperatureCodes: { 24: HEAT_24_HEX }
    }
  }
};

const newAccessory = (overrides) => new HeaterCooler(
  null,
  Object.assign(JSON.parse(JSON.stringify(config)), overrides),
  'FakeServiceManager'
);

// setCharacteristic doesn't surface the async send chain and sendData defers through the device
// mutex, so give each write a moment to flush before resetting or asserting
const write = async (accessory, characteristic, value) => {
  accessory.serviceManager.setCharacteristic(characteristic, value);
  await delayForDuration(0.2);
};

// A HomeKit scene/automation replays its full captured snapshot - Active, mode, thresholds, fan,
// swing - even when the scene sets the unit to "off". Codes for these ACs always encode the whole
// unit state, so transmitting any of them while the unit is off physically powers it on. These
// writes must be stored, not sent.
describe('heaterCooler characteristic writes while the unit is off', () => {
  it('does not transmit when a scene replays a mode while the unit is off', async () => {
    const accessory = newAccessory();
    expect(accessory.state.active).to.equal(Characteristic.Active.INACTIVE);
    // Unit last used in cool; the automation snapshot carries heat (the incident from the field)
    accessory.state.targetHeaterCoolerState = Characteristic.TargetHeaterCoolerState.COOL;

    // The burst an "off" scene actually writes: Active (already off), then the captured mode
    await write(accessory, Characteristic.Active, Characteristic.Active.INACTIVE);
    device.resetSentHexCodes(); // the Active=off write may legitimately send the off code
    await write(accessory, Characteristic.TargetHeaterCoolerState, Characteristic.TargetHeaterCoolerState.HEAT);

    expect(device.getSentHexCodeCount()).to.equal(0);
    // The mode is stored, ready for the next power-on
    expect(accessory.state.targetHeaterCoolerState).to.equal(Characteristic.TargetHeaterCoolerState.HEAT);
  }).timeout(4000);

  it('does not transmit when a threshold temperature is written while the unit is off', async () => {
    const accessory = newAccessory();
    accessory.state.targetHeaterCoolerState = Characteristic.TargetHeaterCoolerState.HEAT;
    device.resetSentHexCodes();

    await write(accessory, Characteristic.HeatingThresholdTemperature, 24);

    expect(device.getSentHexCodeCount()).to.equal(0);
    expect(accessory.state.heatingThresholdTemperature).to.equal(24);
  }).timeout(4000);

  it('uses the stored mode when the unit is later turned on for real', async () => {
    const accessory = newAccessory();
    accessory.state.targetHeaterCoolerState = Characteristic.TargetHeaterCoolerState.COOL;

    // Mode written while off - stored only
    await write(accessory, Characteristic.TargetHeaterCoolerState, Characteristic.TargetHeaterCoolerState.HEAT);
    device.resetSentHexCodes();

    // A real power-on transmits, and in the stored mode
    await write(accessory, Characteristic.Active, Characteristic.Active.ACTIVE);

    expect(device.hasSentCode(HEAT_24_HEX)).to.equal(true);
  }).timeout(4000);

  it('still transmits a mode change while the unit is on', async () => {
    const accessory = newAccessory();
    accessory.state.targetHeaterCoolerState = Characteristic.TargetHeaterCoolerState.COOL;

    await write(accessory, Characteristic.Active, Characteristic.Active.ACTIVE);
    device.resetSentHexCodes();

    await write(accessory, Characteristic.TargetHeaterCoolerState, Characteristic.TargetHeaterCoolerState.HEAT);

    expect(device.hasSentCode(HEAT_24_HEX)).to.equal(true);
  }).timeout(4000);

  it('still transmits a temperature change while the unit is on', async () => {
    const accessory = newAccessory({ coolingThresholdTemperature: 20 });
    accessory.state.targetHeaterCoolerState = Characteristic.TargetHeaterCoolerState.COOL;

    await write(accessory, Characteristic.Active, Characteristic.Active.ACTIVE);
    device.resetSentHexCodes();

    await write(accessory, Characteristic.CoolingThresholdTemperature, 24);

    expect(device.hasSentCode(COOL_24_HEX)).to.equal(true);
  }).timeout(4000);
});
