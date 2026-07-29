const os = require('os');
const path = require('path');
const { expect } = require('chai');

const { setup } = require('./helpers/setup');
const HeaterCooler = require('../accessories/heater-cooler');

// The platform initialises node-persist on construction; keep it out of the real homebridge dir
const { device } = setup({ homebridgeDirectory: path.join(os.tmpdir(), 'homebridge-broadlink-rm-test') });

const ENERGY = (power) => JSON.stringify({
  starttime: '2023-04-04 01:20:48',
  total: '0.095',
  yesterday: '0.02',
  today: '0.005',
  voltage: '229',
  current: '0',
  power: String(power),
  apparent_power: '0',
  reactive_power: '0',
  factor: '0'
});

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
  minTemperature: 16,
  maxTemperature: 30,
  mqttURL: 'mqtt://localhost',
  mqttTopic: [{ identifier: 'power', topic: 'athom_ac_plug/energy' }],
  data: {
    cool: {
      on: 'COOL_ON',
      off: 'OFF',
      temperatureCodes: {
        24: 'COOL24'
      }
    }
  }
};

const BOTH_TOPICS = [
  { identifier: 'power', topic: 'athom_ac_plug/energy' },
  { identifier: 'temperature', topic: 'sensor/livingroom' }
];

const newAccessory = (overrides) => new HeaterCooler(
  null,
  Object.assign(JSON.parse(JSON.stringify(config)), overrides),
  'FakeServiceManager'
);

// There is no broker in tests, and mqttValueForIdentifier() bails unless the client is connected
const connectMQTT = (accessory) => { accessory.mqttClient.connected = true; };

// MQTT temperature only reaches state.currentTemperature when HomeKit reads the characteristic
const readTemperature = (accessory) => new Promise((resolve, reject) => {
  accessory.getCurrentTemperature((err, value) => (err ? reject(err) : resolve(value)));
});

describe('heaterCooler mqtt power state detection', () => {
  it('reports ACTIVE above the on threshold without sending hex', () => {
    const accessory = newAccessory();
    device.resetSentHexCodes();

    accessory.onMQTTMessage('power', Buffer.from(ENERGY(850)));

    expect(accessory.state.active).to.equal(Characteristic.Active.ACTIVE);
    expect(accessory.serviceManager.getCharacteristic(Characteristic.Active).value)
      .to.equal(Characteristic.Active.ACTIVE);
    expect(device.getSentHexCodeCount()).to.equal(0);
  });

  it('reports INACTIVE below the off threshold without sending hex', () => {
    const accessory = newAccessory();
    accessory.state.active = Characteristic.Active.ACTIVE;
    device.resetSentHexCodes();

    accessory.onMQTTMessage('power', Buffer.from(ENERGY(3)));

    expect(accessory.state.active).to.equal(Characteristic.Active.INACTIVE);
    expect(device.getSentHexCodeCount()).to.equal(0);
  });

  it('ignores readings inside the standby band', () => {
    const accessory = newAccessory();
    accessory.state.active = Characteristic.Active.ACTIVE;

    accessory.onMQTTMessage('power', Buffer.from(ENERGY(15)));

    expect(accessory.state.active).to.equal(Characteristic.Active.ACTIVE);
  });

  it('honours custom thresholds and key', () => {
    const accessory = newAccessory({
      mqttPowerKey: 'apparent_power',
      mqttPowerOnThreshold: 100,
      mqttPowerOffThreshold: 50
    });

    accessory.onMQTTMessage('power', Buffer.from(JSON.stringify({ power: '900', apparent_power: '60' })));
    expect(accessory.state.active).to.equal(Characteristic.Active.INACTIVE, 'inside band -> unchanged');

    accessory.onMQTTMessage('power', Buffer.from(JSON.stringify({ power: '0', apparent_power: '120' })));
    expect(accessory.state.active).to.equal(Characteristic.Active.ACTIVE);
  });

  it('accepts a bare numeric payload', () => {
    const accessory = newAccessory();

    accessory.onMQTTMessage('power', Buffer.from('740'));

    expect(accessory.state.active).to.equal(Characteristic.Active.ACTIVE);
  });

  it('accepts a nested payload (Tasmota style)', () => {
    const accessory = newAccessory({ mqttPowerKey: 'Power' });

    accessory.onMQTTMessage('power', Buffer.from(JSON.stringify({ ENERGY: { Power: 640 } })));

    expect(accessory.state.active).to.equal(Characteristic.Active.ACTIVE);
  });

  it('ignores plug readings during the grace period after a HomeKit change', async () => {
    const accessory = newAccessory();
    accessory.config.mqttPowerGrace = 2;

    accessory.startMQTTPowerGrace();
    accessory.onMQTTMessage('power', Buffer.from(ENERGY(900)));

    expect(accessory.state.active).to.equal(Characteristic.Active.INACTIVE, 'suppressed during grace');

    await new Promise((resolve) => setTimeout(resolve, 2200));

    accessory.onMQTTMessage('power', Buffer.from(ENERGY(900)));
    expect(accessory.state.active).to.equal(Characteristic.Active.ACTIVE, 'applied after grace');
  }).timeout(6000);

  it('still reads temperature from the Broadlink device when only a power topic is configured', () => {
    const accessory = newAccessory();
    expect(accessory.hasMQTTTemperatureTopic()).to.equal(false);

    const withTemperature = newAccessory({ mqttTopic: BOTH_TOPICS });
    expect(withTemperature.hasMQTTTemperatureTopic()).to.equal(true);
  });

  // Power and temperature topics side by side - the case that matters in practice
  it('tracks power and temperature independently on separate topics', async () => {
    const accessory = newAccessory({ mqttTopic: BOTH_TOPICS, noHumidity: true });
    connectMQTT(accessory);
    device.resetSentHexCodes();

    accessory.onMQTTMessage('temperature', Buffer.from(JSON.stringify({ temperature: '23.4' })));
    accessory.onMQTTMessage('power', Buffer.from(ENERGY(910)));

    expect(accessory.mqttValues.temperature).to.equal(23.4);
    expect(await readTemperature(accessory)).to.equal(23.4);
    expect(accessory.state.active).to.equal(Characteristic.Active.ACTIVE);

    // A power reading must not disturb the cached temperature
    accessory.onMQTTMessage('power', Buffer.from(ENERGY(2)));

    expect(accessory.mqttValues.temperature).to.equal(23.4);
    expect(await readTemperature(accessory)).to.equal(23.4);
    expect(accessory.state.active).to.equal(Characteristic.Active.INACTIVE);

    // ...and a temperature reading must not disturb the detected state
    accessory.onMQTTMessage('temperature', Buffer.from(JSON.stringify({ temperature: '25.1' })));

    expect(await readTemperature(accessory)).to.equal(25.1);
    expect(accessory.state.active).to.equal(Characteristic.Active.INACTIVE);
    expect(device.getSentHexCodeCount()).to.equal(0);
  });

  it('reads temperature and power from one combined payload', async () => {
    const accessory = newAccessory({
      mqttTopic: [
        { identifier: 'combined', topic: 'sensor/livingroom' },
        { identifier: 'power', topic: 'athom_ac_plug/energy' }
      ]
    });
    connectMQTT(accessory);

    accessory.onMQTTMessage('combined', Buffer.from(JSON.stringify({ temperature: '21.5', humidity: '48' })));
    accessory.onMQTTMessage('power', Buffer.from(ENERGY(880)));

    expect(await readTemperature(accessory)).to.equal(21.5);
    expect(accessory.state.currentHumidity).to.equal(48);
    expect(accessory.state.active).to.equal(Characteristic.Active.ACTIVE);
  });

  it('exposes only the HeaterCooler service', () => {
    const accessory = newAccessory();

    expect(accessory.getServices().some((service) => service instanceof Service.ContactSensor)).to.equal(false);
  });

  it('applies the plug reading once the grace period has passed', async () => {
    const accessory = newAccessory();
    accessory.config.mqttPowerGrace = 2;

    accessory.startMQTTPowerGrace();
    accessory.onMQTTMessage('power', Buffer.from(ENERGY(900)));

    // Still suppressed - a HomeKit initiated change hasn't settled yet
    expect(accessory.state.active).to.equal(Characteristic.Active.INACTIVE);

    await new Promise((resolve) => setTimeout(resolve, 2200));

    accessory.onMQTTMessage('power', Buffer.from(ENERGY(900)));
    expect(accessory.state.active).to.equal(Characteristic.Active.ACTIVE);
  }).timeout(6000);

  it('rejects a payload with no usable value', () => {
    const accessory = newAccessory();

    accessory.onMQTTMessage('power', Buffer.from(JSON.stringify({ voltage: '229' })));

    expect(accessory.state.active).to.equal(Characteristic.Active.INACTIVE);
  });
});
