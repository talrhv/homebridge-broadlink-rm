const os = require('os');
const path = require('path');
const { expect } = require('chai');

const { log, setup } = require('./helpers/setup')
const FakeServiceManager = require('./helpers/fakeServiceManager')
const hexCheck = require('./helpers/hexCheck')
const delayForDuration = require('../helpers/delayForDuration')
const { getDevice } = require('../helpers/getDevice')
const { buildIRHex, jitter } = require('./helpers/irHex')

const { AirCon, Switch } = require('../accessories')

// node-persist needs somewhere writable to initialise; keep it out of the real homebridge dir
const testSetup = () => setup({ homebridgeDirectory: path.join(os.tmpdir(), 'homebridge-broadlink-rm-test') });

const data = {
  on: 'ON',
  off: 'OFF',
  temperature16: {
    'pseudo-mode': 'cool',
    'data': 'TEMPERATURE_16'
  },
  temperature18: {
    'pseudo-mode': 'cool',
    'data': 'TEMPERATURE_18'
  },
  temperature23: {
    'pseudo-mode': 'heat',
    'data': 'TEMPERATURE_23'
  },
  temperature26: {
    'pseudo-mode': 'heat',
    'data': 'TEMPERATURE_26'
  },
  temperature30: {
    'pseudo-mode': 'heat',
    'data': 'TEMPERATURE_30'
  }
};

const defaultConfig = {
  data,
  isUnitTest: true,
  persistState: false,
  noHistory: true
};

describe('airConAccessory', async () => {

  it ('default config', async () => {
    const { device } = setup();
    defaultConfig.host = device.host.address

    const config = {
      ...defaultConfig
    };
    
    const airConAccessory = new AirCon(null, config, 'FakeServiceManager');
    
    expect(airConAccessory.config.turnOnWhenOff).to.equal(false);
    expect(airConAccessory.config.minimumAutoOnOffDuration).to.equal(120);
    expect(airConAccessory.config.minTemperature).to.equal(-15);
    expect(airConAccessory.config.maxTemperature).to.equal(50);
    expect(airConAccessory.config.tempStepSize).to.equal(1);
    expect(airConAccessory.config.units).to.equal('c');
    expect(airConAccessory.config.temperatureUpdateFrequency).to.equal(10);
    expect(airConAccessory.config.temperatureAdjustment).to.equal(0);
    expect(airConAccessory.config.defaultCoolTemperature).to.equal(16);
    expect(airConAccessory.config.defaultHeatTemperature).to.equal(30);
    expect(airConAccessory.config.heatTemperature).to.equal(22);
    expect(airConAccessory.config.replaceAutoMode).to.equal('cool');
  });

  it('custom config', async () => {
    const { device } = setup();
    defaultConfig.host = device.host.address

    const config = {
      ...defaultConfig,
      turnOnWhenOff: true,
      minimumAutoOnOffDuration: 60,
      minTemperature: 2,
      maxTemperature: 36,
      tempStepSize: 0.5,
      units: 'f',
      temperatureUpdateFrequency: 20,
      temperatureAdjustment: 1,
      defaultCoolTemperature: 17,
      defaultHeatTemperature: 32,
      heatTemperature: 20,
      replaceAutoMode: 'heat'
    };
    
    const airConAccessory = new AirCon(null, config, 'FakeServiceManager');
    
    expect(airConAccessory.config.turnOnWhenOff).to.equal(true);
    expect(airConAccessory.config.minimumAutoOnOffDuration).to.equal(60);
    expect(airConAccessory.config.minTemperature).to.equal(2);
    expect(airConAccessory.config.maxTemperature).to.equal(36);
    expect(airConAccessory.config.tempStepSize).to.equal(0.5);
    expect(airConAccessory.config.units).to.equal('f');
    expect(airConAccessory.config.temperatureUpdateFrequency).to.equal(20);
    expect(airConAccessory.config.temperatureAdjustment).to.equal(1);
    expect(airConAccessory.config.defaultCoolTemperature).to.equal(17);
    expect(airConAccessory.config.defaultHeatTemperature).to.equal(32);
    expect(airConAccessory.config.heatTemperature).to.equal(20);
    expect(airConAccessory.config.replaceAutoMode).to.equal('heat');
  });


  it('tun on', async () => {
    const { device } = setup();
    defaultConfig.host = device.host.address
    
    const config = {
      ...defaultConfig
    };

    const airConAccessory = new AirCon(null, config, 'FakeServiceManager');

    // Set air-con mode to "auto"
    airConAccessory.serviceManager.setCharacteristic(Characteristic.TargetHeatingCoolingState, Characteristic.TargetHeatingCoolingState.AUTO);

    await delayForDuration(0.6);

    // Check hex codes were sent
    hexCheck({ device, codes: [ 'TEMPERATURE_16' ], count: 1 });

    // Check `replaceAutoMode` worked as expected
    expect(airConAccessory.state.targetHeatingCoolingState).to.equal(Characteristic.TargetHeatingCoolingState.COOL);
  });

  it('tun off', async () => {
    const { device } = setup();
    defaultConfig.host = device.host.address
    
    const config = {
      ...defaultConfig
    };

    const airConAccessory = new AirCon(null, config, 'FakeServiceManager');

    // Set air-con mode to "auto"
    airConAccessory.serviceManager.setCharacteristic(Characteristic.TargetHeatingCoolingState, Characteristic.TargetHeatingCoolingState.AUTO);

    await delayForDuration(0.6);

    // Check hex codes were sent
    hexCheck({ device, codes: [ 'TEMPERATURE_16' ], count: 1 });

    await delayForDuration(0.3);

    // Set air-con mode to "off"
    airConAccessory.serviceManager.setCharacteristic(Characteristic.TargetHeatingCoolingState, Characteristic.TargetHeatingCoolingState.OFF);

    await delayForDuration(0.3);

    // Check hex codes were sent
    hexCheck({ device, codes: [ 'TEMPERATURE_16', 'OFF' ], count: 2 });
  });


  it('set heat', async () => {
    const { device } = setup();
    defaultConfig.host = device.host.address
    
    const config = {
      ...defaultConfig
    };

    const airConAccessory = new AirCon(null, config, 'FakeServiceManager');

    // Set air-con mode to "auto"
    airConAccessory.serviceManager.setCharacteristic(Characteristic.TargetHeatingCoolingState, Characteristic.TargetHeatingCoolingState.HEAT);

    await delayForDuration(0.3);

    // Check hex codes were sent
    hexCheck({ device, codes: [ 'TEMPERATURE_30' ], count: 1 });
  });

  it('set cool', async () => {
    const { device } = setup();
    defaultConfig.host = device.host.address
    
    const config = {
      ...defaultConfig
    };

    const airConAccessory = new AirCon(null, config, 'FakeServiceManager');

    // Set air-con mode to "auto"
    airConAccessory.serviceManager.setCharacteristic(Characteristic.TargetHeatingCoolingState, Characteristic.TargetHeatingCoolingState.COOL);

    await delayForDuration(0.3);

    // Check hex codes were sent
    hexCheck({ device, codes: [ 'TEMPERATURE_16' ], count: 1 });
  });


  it('set heat temperature', async () => {
    const { device } = setup();
    defaultConfig.host = device.host.address
    
    const config = {
      ...defaultConfig
    };

    const airConAccessory = new AirCon(null, config, 'FakeServiceManager');

    // Set temperature to be above heatTemperature
    airConAccessory.serviceManager.setCharacteristic(Characteristic.TargetTemperature, 26);

    await delayForDuration(0.3);

    // Check hex codes were sent
    hexCheck({ device, codes: [ 'TEMPERATURE_26' ], count: 1 });
  });

  it('set cool temperature', async () => {

    const { device } = setup();
    defaultConfig.host = device.host.address
    
    const config = {
      ...defaultConfig
    };

    const airConAccessory = new AirCon(null, config, 'FakeServiceManager');

    // Set temperature to be above heatTemperature
    airConAccessory.serviceManager.setCharacteristic(Characteristic.TargetTemperature, 18);

    await delayForDuration(0.3);

    // Check hex codes were sent
    hexCheck({ device, codes: [ 'TEMPERATURE_18' ], count: 1 });
  });


  it('set missing heat temperature', async () => {

    const { device } = setup();
    defaultConfig.host = device.host.address
    
    const config = {
      ...defaultConfig
    };

    const airConAccessory = new AirCon(null, config, 'FakeServiceManager');

    // Set temperature to be above heatTemperature
    airConAccessory.serviceManager.setCharacteristic(Characteristic.TargetTemperature, 24);

    await delayForDuration(0.3);

    // Check hex codes were sent
    hexCheck({ device, codes: [ 'TEMPERATURE_30' ], count: 1 });
  });

  it('set missing cool temperature', async () => {
    const { device } = setup();
    defaultConfig.host = device.host.address
    
    const config = {
      ...defaultConfig
    };

    const airConAccessory = new AirCon(null, config, 'FakeServiceManager');

    // Set temperature to be above heatTemperature
    airConAccessory.serviceManager.setCharacteristic(Characteristic.TargetTemperature, 20);

    await delayForDuration(0.3);

    // Check hex codes were sent
    hexCheck({ device, codes: [ 'TEMPERATURE_16' ], count: 1 });
  });

  it ('"turnOnWhenOff": true', async () => {
    const { device } = setup();
    defaultConfig.host = device.host.address
    
    const config = {
      ...defaultConfig,
      turnOnWhenOff: true
    };

    const airConAccessory = new AirCon(null, config, 'FakeServiceManager');

    // Set temperature to be above heatTemperature
    airConAccessory.serviceManager.setCharacteristic(Characteristic.TargetTemperature, 26);

    await delayForDuration(1);

    // Check hex codes were sent
    hexCheck({ device, codes: [ 'TEMPERATURE_26', 'ON' ], count: 2 });
  });

  it ('"allowResend": true', async () => {
    const { device } = setup();
    defaultConfig.host = device.host.address
    
    const config = {
      ...defaultConfig,
      allowResend: true
    };

    const airConAccessory = new AirCon(null, config, 'FakeServiceManager');

    // Set temperature to be above heatTemperature
    airConAccessory.serviceManager.setCharacteristic(Characteristic.TargetTemperature, 26);

    await delayForDuration(0.3);

    // Check hex codes were sent
    hexCheck({ device, codes: [ 'TEMPERATURE_26' ], count: 1 });

    // Set temperature to be above heatTemperature
    airConAccessory.serviceManager.setCharacteristic(Characteristic.TargetTemperature, 26);

    await delayForDuration(0.3);

    // Check hex codes were sent
    hexCheck({ device, codes: [ 'TEMPERATURE_26' ], count: 2 });
  });

  it ('"allowResend": false', async () => {
    const { device } = setup();
    defaultConfig.host = device.host.address
    
    const config = {
      ...defaultConfig,
      allowResend: false
    };

    const airConAccessory = new AirCon(null, config, 'FakeServiceManager');

    // Set temperature to be above heatTemperature
    airConAccessory.serviceManager.setCharacteristic(Characteristic.TargetTemperature, 26);

    await delayForDuration(0.3);

    // Check hex codes were sent
    hexCheck({ device, codes: [ 'TEMPERATURE_26' ], count: 1 });

    // Set temperature to be above heatTemperature
    airConAccessory.serviceManager.setCharacteristic(Characteristic.TargetTemperature, 26);

    await delayForDuration(0.3);

    // Check hex codes were sent
    hexCheck({ device, codes: [ 'TEMPERATURE_26' ], count: 1 });
  });


  it('auto-heat & "minimumAutoOnOffDuration": 0.5', async () => {
    const { device } = setup();
    defaultConfig.host = device.host.address
    
    const config = {
      ...defaultConfig,
      autoHeatTemperature: 18,
      autoCoolTemperature: 27,
      minimumAutoOnOffDuration: 1
    };

    const airConAccessory = new AirCon(null, config, 'FakeServiceManager');

    device.sendFakeOnCallback('temperature', 17)

    await delayForDuration(0.3);
    
    // Check auto-on was performed by ensuring hex codes were sent
    hexCheck({ device, codes: [ 'TEMPERATURE_30' ], count: 1 });

    // Test `minimumAutoOnOffDuration` by forcing auto-on/off check with a normal temperature
    // Use a temperature lower than `autoCoolTemperature` so that the air-con should automatically turn off
    await delayForDuration(0.3);

    airConAccessory.updateTemperatureUI();
    
    device.sendFakeOnCallback('temperature', 23)
    
    await delayForDuration(0.3);
    
    // No more hex codes should have been sent yet due to `minimumAutoOnOffDuration`
    hexCheck({ device, codes: [ 'TEMPERATURE_30' ], count: 1 });

    await delayForDuration(0.3);
    
    // Try forcing auto-on/off again with a normal temperature
    airConAccessory.updateTemperatureUI();

    device.sendFakeOnCallback('temperature', 23)

    await delayForDuration(0.3);
    
    // auto-off should have occurred by now as 1.2s has passed
    hexCheck({ device, codes: [ 'TEMPERATURE_30', 'OFF' ], count: 2 });
  }).timeout(3000);


  it('auto-cool & "minimumAutoOnOffDuration": 0.5', async () => {
    const { device } = setup();
    defaultConfig.host = device.host.address
    
    const config = {
      ...defaultConfig,
      autoHeatTemperature: 18,
      autoCoolTemperature: 27,
      minimumAutoOnOffDuration: 1
    };

    const airConAccessory = new AirCon(null, config, 'FakeServiceManager');

    device.sendFakeOnCallback('temperature', 28)

    await delayForDuration(0.3);
    
    // Check auto-on was performed by ensuring hex codes were sent
    hexCheck({ device, codes: [ 'TEMPERATURE_16' ], count: 1 });

    // Test `minimumAutoOnOffDuration` by forcing auto-on/off check with a normal temperature
    // Use a temperature lower than `autoCoolTemperature` so that the air-con should automatically turn off
    await delayForDuration(0.3);

    airConAccessory.updateTemperatureUI();
    
    device.sendFakeOnCallback('temperature', 26)
    
    await delayForDuration(0.3);
    
    // No more hex codes should have been sent yet due to `minimumAutoOnOffDuration`
    hexCheck({ device, codes: [ 'TEMPERATURE_16' ], count: 1 });

    await delayForDuration(0.3);
    
    // Try forcing auto-on/off again with a normal temperature
    airConAccessory.updateTemperatureUI();

    device.sendFakeOnCallback('temperature', 26)

    await delayForDuration(0.3);
    
    // auto-off should have occurred by now as 1.2s has passed
    hexCheck({ device, codes: [ 'TEMPERATURE_16', 'OFF' ], count: 2 });
  }).timeout(3000);


  it ('"pseudoDeviceTemperature": 2', async () => {
    const { device } = setup();
    defaultConfig.host = device.host.address
    
    const config = {
      ...defaultConfig,
      pseudoDeviceTemperature: 2
    };

    const airConAccessory = new AirCon(null, config, 'FakeServiceManager');

    const getTemperaturePromise = airConAccessory.serviceManager.getCharacteristic(Characteristic.CurrentTemperature).getValue();

    await delayForDuration(0.3);

    device.sendFakeOnCallback('temperature', 20);

    const temperature = await getTemperaturePromise;

    expect(temperature).to.equal(2);
  });


  it ('"temperatureAdjustment": 10', async () => {
    const { device } = setup();
    defaultConfig.host = device.host.address
    
    const config = {
      ...defaultConfig,
      temperatureAdjustment: 10
    };

    const airConAccessory = new AirCon(null, config, 'FakeServiceManager');

    const getTemperaturePromise = airConAccessory.serviceManager.getCharacteristic(Characteristic.CurrentTemperature).getValue();

    await delayForDuration(0.3);

    device.sendFakeOnCallback('temperature', 20);

    const temperature = await getTemperaturePromise;

    expect(temperature).to.equal(30);
  });

  it ('"temperatureAdjustment": -10', async () => {
    const { device } = setup();
    defaultConfig.host = device.host.address
    
    const config = {
      ...defaultConfig,
      temperatureAdjustment: -10
    };

    const airConAccessory = new AirCon(null, config, 'FakeServiceManager');

    const getTemperaturePromise = airConAccessory.serviceManager.getCharacteristic(Characteristic.CurrentTemperature).getValue();

    await delayForDuration(0.3);

    device.sendFakeOnCallback('temperature', 20);

    const temperature = await getTemperaturePromise;

    expect(temperature).to.equal(10);
  });

  it ('"replaceAutoMode": "heat"', async () => {
    const { device } = setup();
    defaultConfig.host = device.host.address
    
    const config = {
      ...defaultConfig,
      replaceAutoMode: 'heat'
    };

    const airConAccessory = new AirCon(null, config, 'FakeServiceManager');

    // Set air-con mode to "auto"
    airConAccessory.serviceManager.setCharacteristic(Characteristic.TargetHeatingCoolingState, Characteristic.TargetHeatingCoolingState.AUTO);

    await delayForDuration(0.6);

    // Check hex codes were sent
    hexCheck({ device, codes: [ 'TEMPERATURE_30' ], count: 1 });

    // Check `replaceAutoMode` worked as expected
    expect(airConAccessory.state.targetHeatingCoolingState).to.equal(Characteristic.TargetHeatingCoolingState.HEAT);
  });

  it ('autoSwitch', async () => {
    const { device } = setup();
    defaultConfig.host = device.host.address

    const config = {
      ...defaultConfig,
      autoSwitch: 'Air-Con Auto'
    };

    const switchConfig = {
      ...defaultConfig,
      name: 'Air-Con Auto'
    };

    const airConAccessory = new AirCon(null, config, 'FakeServiceManager');
    const switchAccessory = new Switch(null, switchConfig, 'FakeServiceManager');

    airConAccessory.updateAccessories([ switchAccessory ]);

    expect(airConAccessory.autoSwitchAccessory).to.equal(switchAccessory)
  });

  describe('handleExternalIRCode (passive remote-control detection)', () => {
    // Distinct, well-separated (pairwise average pulse difference >= 12) synthetic pulse
    // patterns - real IR captures of different remote buttons look like this: same overall
    // structure, very different bit content. jitter() simulates the receiver's natural timing
    // noise on a live capture of the same button.
    const OFF_PULSES = [54,54,54,20,20,54,54,54,54,54,20,54,20,54,54,54,54,54,20,54,54,20,20,20,20,20,20,54,54,20,54,20];
    const TEMPERATURE_23_PULSES = [54,20,20,54,20,20,20,54,54,54,54,20,20,20,54,54,54,20,20,54,54,54,20,20,54,20,20,54,20,20,20,20];

    const irData = {
      off: buildIRHex(OFF_PULSES),
      temperature23: {
        'pseudo-mode': 'heat',
        'data': buildIRHex(TEMPERATURE_23_PULSES)
      }
    };

    it('updates target temperature and mode from a known remote-control hex code, without sending anything', async () => {
      const { device } = testSetup();

      const config = { ...defaultConfig, data: irData, host: device.host.address };
      const airConAccessory = new AirCon(null, config, 'FakeServiceManager');
      airConAccessory.irCodeCandidates = airConAccessory.buildIRCodeCandidates();

      device.resetSentHexCodes();

      airConAccessory.handleExternalIRCode(buildIRHex(jitter(TEMPERATURE_23_PULSES)));

      expect(airConAccessory.state.targetTemperature).to.equal(23);
      expect(airConAccessory.state.targetHeatingCoolingState).to.equal(Characteristic.TargetHeatingCoolingState.HEAT);
      expect(airConAccessory.state.currentHeatingCoolingState).to.equal(Characteristic.TargetHeatingCoolingState.HEAT);
      expect(airConAccessory.serviceManager.getCharacteristic(Characteristic.TargetTemperature).value).to.equal(23);
      expect(device.getSentHexCodeCount()).to.equal(0);
    });

    it('turns the accessory off when the "off" hex code is detected', async () => {
      const { device } = testSetup();

      const config = { ...defaultConfig, data: irData, host: device.host.address };
      const airConAccessory = new AirCon(null, config, 'FakeServiceManager');
      airConAccessory.irCodeCandidates = airConAccessory.buildIRCodeCandidates();

      device.resetSentHexCodes();

      airConAccessory.handleExternalIRCode(buildIRHex(jitter(OFF_PULSES)));

      expect(airConAccessory.state.targetHeatingCoolingState).to.equal(Characteristic.TargetHeatingCoolingState.OFF);
      expect(airConAccessory.state.currentHeatingCoolingState).to.equal(Characteristic.CurrentHeatingCoolingState.OFF);
      expect(device.getSentHexCodeCount()).to.equal(0);
    });

    it('ignores an unrecognised hex code', async () => {
      const { device } = testSetup();

      const config = { ...defaultConfig, data: irData, host: device.host.address };
      const airConAccessory = new AirCon(null, config, 'FakeServiceManager');
      airConAccessory.irCodeCandidates = airConAccessory.buildIRCodeCandidates();

      const previousTargetTemperature = airConAccessory.state.targetTemperature;
      const previousTargetHeatingCoolingState = airConAccessory.state.targetHeatingCoolingState;
      device.resetSentHexCodes();

      // Different length entirely - guaranteed to fall outside the pulse-count tolerance
      airConAccessory.handleExternalIRCode(buildIRHex([20, 54, 20, 54, 20, 54, 20, 54]));

      expect(airConAccessory.state.targetTemperature).to.equal(previousTargetTemperature);
      expect(airConAccessory.state.targetHeatingCoolingState).to.equal(previousTargetHeatingCoolingState);
      expect(device.getSentHexCodeCount()).to.equal(0);
    });
  });

  describe('resuming the last used temperature per mode after being turned off', () => {
    it('resumes the last cool temperature instead of resetting to defaultCoolTemperature', async () => {
      const { device } = testSetup();
      defaultConfig.host = device.host.address

      const config = { ...defaultConfig };
      const airConAccessory = new AirCon(null, config, 'FakeServiceManager');

      // Turn on to cool (defaults to 16), then change to a non-default temperature (18)
      airConAccessory.serviceManager.setCharacteristic(Characteristic.TargetHeatingCoolingState, Characteristic.TargetHeatingCoolingState.COOL);
      await delayForDuration(0.6);
      airConAccessory.serviceManager.setCharacteristic(Characteristic.TargetTemperature, 18);
      await delayForDuration(0.6);

      // Turn off
      airConAccessory.serviceManager.setCharacteristic(Characteristic.TargetHeatingCoolingState, Characteristic.TargetHeatingCoolingState.OFF);
      await delayForDuration(0.6);

      device.resetSentHexCodes();

      // Turn cool back on - should resume 18, not reset to the configured default (16)
      airConAccessory.serviceManager.setCharacteristic(Characteristic.TargetHeatingCoolingState, Characteristic.TargetHeatingCoolingState.COOL);
      await delayForDuration(0.6);

      expect(airConAccessory.state.targetTemperature).to.equal(18);
      hexCheck({ device, codes: [ 'TEMPERATURE_18' ], count: 1 });
    }).timeout(4000);

    it('resumes the last heat temperature instead of resetting to defaultHeatTemperature', async () => {
      const { device } = testSetup();
      defaultConfig.host = device.host.address

      const config = { ...defaultConfig };
      const airConAccessory = new AirCon(null, config, 'FakeServiceManager');

      // Turn on to heat (defaults to 30), then change to a non-default temperature (26)
      airConAccessory.serviceManager.setCharacteristic(Characteristic.TargetHeatingCoolingState, Characteristic.TargetHeatingCoolingState.HEAT);
      await delayForDuration(0.6);
      airConAccessory.serviceManager.setCharacteristic(Characteristic.TargetTemperature, 26);
      await delayForDuration(0.6);

      // Turn off
      airConAccessory.serviceManager.setCharacteristic(Characteristic.TargetHeatingCoolingState, Characteristic.TargetHeatingCoolingState.OFF);
      await delayForDuration(0.6);

      device.resetSentHexCodes();

      // Turn heat back on - should resume 26, not reset to the configured default (30)
      airConAccessory.serviceManager.setCharacteristic(Characteristic.TargetHeatingCoolingState, Characteristic.TargetHeatingCoolingState.HEAT);
      await delayForDuration(0.6);

      expect(airConAccessory.state.targetTemperature).to.equal(26);
      hexCheck({ device, codes: [ 'TEMPERATURE_26' ], count: 1 });
    }).timeout(4000);
  });
})
