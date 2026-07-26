# Heater Cooler

## Configuration keys and usage
| key | description | example | default |
| -- | -- | -- | -- |
| *name* | Name that you would like to give the device | LG AC | - |
| *type* | Recognizes device as a heater-cooler and parses it accordingly | heater-cooler | heater-cooler |
| temperatureUnits | Temperature units to parse the config file | F | C |
| coolingThresholdTemperature | Temperature to set the cooler to | 70 | 35 C |
| heatingThresholdTemperature | Temperature to set the heater to | 67 | 10 C |
| minTemperature | Minimum temperature that can be set on device | 65 | - |
| maxTemperature | Maximum temperature that can be set on device | 80 | - |
| defaultRotationSpeed | Default fan speed to set when turning on device | 50 | 100 |
| fanStepSize | Increments of fan speed | 25 | 1 |
| *data* | Object with hex codes for device operation | - | - |

### data
| key | description |
| -- | -- |
| heat | Options and data values to support heat mode operation |
| cool | Options and data values to support cool mode operation |

### heat / cool
| key | description |
| -- | -- |
| *on* | Hex data to turn on corresponding mode |
| *off* | Hex data to turn off corresponding mode |
| temperatureCodes | Options and data values to support temperature control in corresponding mode |
| 67 | Hex code to set the device to 67 degree |
| rotationSpeedX | Hex code to set rotation speed of device to X at the corresponding temperature e.g. rotationSpeed50 |
| swingOn | Hex code to turn on swing |
| swingOff | Hex code to turn off swing |
| swingDnd | Hex code to set without changing the current swing mode of device |
| swingToggle | Hex code to toggle swing mode |

## Power based state detection (MQTT)

IR is one-way, so the plugin normally only knows the state it last commanded. If the unit is
plugged into an energy monitoring smart plug (Athom V2, Tasmota, Shelly, ...) that publishes its
power draw over MQTT, add a `mqttTopic` entry with the identifier `power` and the accessory will
report the real on/off state to HomeKit.

| key | description | example | default |
| -- | -- | -- | -- |
| mqttURL | Broker to connect to. Required for any MQTT feature | mqtt://192.168.1.10 | - |
| mqttTopic | Topic list; use identifier `power` for the plug's energy topic | see below | - |
| mqttPowerKey | Key to read from the JSON payload. Nested objects are searched too | apparent_power | power |
| mqttPowerOnThreshold | Above this many watts the unit is reported Active | 20 | 20 |
| mqttPowerOffThreshold | Below this many watts the unit is reported Inactive | 10 | 10 |
| mqttPowerGrace | Seconds to ignore plug readings after a HomeKit initiated change | 30 | 15 |
| mqttPowerStateOnly | `true` updates the tile only. `false` also sends the matching hex codes | false | true |
| mqttPowerSensor | Publish a read-only contact sensor showing what the plug reports | true | false |
| mqttPowerSensorName | Name for that sensor | AC Running | `<name> Power` |

```json
"mqttURL": "mqtt://192.168.1.10",
"mqttTopic": [{
  "identifier": "power",
  "topic": "athom_ac_plug/energy"
}],
"mqttPowerKey": "power",
"mqttPowerOnThreshold": 20,
"mqttPowerOffThreshold": 10,
"mqttPowerGrace": 30
```

The `power` identifier sits alongside the existing ones, so a temperature topic can be subscribed
at the same time - each identifier is parsed independently and a power reading never touches the
cached temperature:

```json
"mqttTopic": [{
  "identifier": "power",
  "topic": "athom_ac_plug/energy"
},{
  "identifier": "temperature",
  "topic": "sensor/livingroom/temperature"
}]
```

Give each identifier its own topic - two identifiers pointing at the same topic string means only
the last one wins. If a single payload carries temperature and humidity together, use the
`combined` identifier for it and keep `power` on the plug's own topic. Without any
temperature-bearing topic, temperature keeps coming from the Broadlink device's own probe.

Values are read with `parseFloat`, so payloads that quote their numbers (`"power": "0"`) work
unchanged. Readings that land *between* the two thresholds are treated as standby and leave the
state untouched - this hysteresis band is what stops a 2-5 W idle draw from flapping the tile.

With the default `mqttPowerStateOnly: true` the plugin only pushes the new value to HomeKit and
never transmits IR/RF in response to a plug reading, so an update cannot toggle the unit. Set it
to `false` only if you deliberately want the plug to drive the unit (this does send hex codes).

`mqttPowerGrace` covers the lag between a HomeKit command and the plug catching up: for the few
seconds after you press the tile, the still-low reading is ignored instead of snapping the tile
back off. Raise it if your plug reports infrequently.

### Seeing the power state

A HeaterCooler service has no characteristic for power draw, so by default the only visible effect
is the tile turning itself on and off. Setting `mqttPowerSensor: true` adds a read-only contact
sensor to the same accessory - **Open** while the unit is drawing power, **Closed** in standby -
which is visible in the Home app and usable as an automation trigger. It is a sensor, so it cannot
be tapped and can never cause a transmission.

The sensor tracks the plug directly rather than the tile, so the two disagree during
`mqttPowerGrace`. That gap is useful: if the tile says on while the sensor still says Closed a
minute later, the IR command never reached the unit, and an automation can react to that.

## FAQ
1. All *italicized* keys are required.
2. At least one of heat or cool object should be present else the device will not be configured and cause an error.
3. 'minTemperature' and 'maxTemperature' are required if device has temperatureCodes
4. This accessory supports combined hex codes for temperature, fan speed and rotation. Please check the config-sample.json file for more details and examples.
5. Swing operation can be supported by providing 'swingOn' and 'swingOff' OR 'swingToggle' and 'swingDnd'.

## How to set-up config.json
This plugin support accessories with different types and combination of available modes. Below is an example of building your config.json based on your device

1. Device supports heat operation
```
{
	"name": "My heater",
	"type": "heater-cooler",
	"data": {
		"heat": {
			"on": "20443...",
			"off": "20443...",
		}
	}
}
```
2. Device supports temperature control
```
{
	"name": "My heater",
	"type": "heater-cooler",
	"minTemperature": 67,
	"maxTemperature": 80,
	"heatingThresholdTemperature": 68,
	"data": {
		"heat": {
			"on": "20443...",
			"off": "20443...",
			"temperatureCodes": {
				"67": "200675...",
				"68": "2006bc..."
			}
		}
	}
}
```

3. Device supports fan speed with state i.e. device has a unique hex code for each combination of rotation speed and temperature
```
{
	"name": "My heater",
	"type": "heater-cooler",
	"minTemperature": 67,
	"maxTemperature": 80,
	"heatingThresholdTemperature": 68,
	"defaultRotationSpeed": 50,
	"fanStepSize": 50,
	"data": {
		"heat": {
			"on": "20443...",
			"off": "20443...",
			"temperatureCodes": {
				"67": {
					"rotationSpeedX": "200675...",
					"rotationSpeedY": ""200678..."
					},
				"68": {
					"rotationSpeedX": "200685...",
					"rotationSpeedY": ""200688..."
					}
			}
		}
	}
}
```


4. Device does not support fan speed but supports swing mode
```
{
	"name": "My heater",
	"type": "heater-cooler",
	"minTemperature": 67,
	"maxTemperature": 80,
	"heatingThresholdTemperature": 68,
	"data": {
		"heat": {
			"on": "20443...",
			"off": "20443...",
			"temperatureCodes": {
				"67": {
					"swingOn": "200675...",
					"swingOff": ""200678..."
					},
				"68": {
					"swingOn": "200685...",
					"swingOff": ""200688..."
					}
			}
		}
	}
}
```

5. Device supports stateful swing mode - device has a unique hex code for each combination of swing mode, rotation speed and temperature
```
{
	"name": "My heater",
	"type": "heater-cooler",
	"minTemperature": 67,
	"maxTemperature": 80,
	"heatingThresholdTemperature": 68,
	"data": {
		"heat": {
			"on": "20443...",
			"off": "20443...",
			"temperatureCodes": {
				"67": {
					"rotationSpeedX": {
						"swingOn": "200675...",
						"swingOff": ""200678..."
					},
					"rotationSpeedY": {
						"swingOn": "200675...",
						"swingOff": ""200678..."
					}
				},
				"68": {
					"rotationSpeedX": {
						"swingOn": "200675...",
						"swingOff": ""200678..."
					},
					"rotationSpeedY": {
						"swingOn": "200675...",
						"swingOff": ""200678..."
					}
				}
			}
		}
	}
}
```

6. Device supports stateful temperaure and fan speed but stateless swing modes i.e. there is a unique hex code to set your device to a defined temperature at a specified speed without changing the current swing mode of the device
```
{
	"name": "My heater",
	"type": "heater-cooler",
	"minTemperature": 67,
	"maxTemperature": 80,
	"heatingThresholdTemperature": 68,
	"data": {
		"heat": {
			"on": "20443...",
			"off": "20443...",
			"temperatureCodes": {
				"67": {
					"rotationSpeedX": {
						"swingDnd": "200675...",
						"swingToggle": ""200678..."
					},
					"rotationSpeedY": {
						"swingDnd": "200675...",
						"swingToggle": ""200678..."
					}
				},
				"68": {
					"rotationSpeedX": {
						"swingDnd": "200675...",
						"swingToggle": ""200678..."
					},
					"rotationSpeedY": {
						"swingDnd": "200675...",
						"swingToggle": ""200678..."
					}
				}
			}
		}
	}
}
```