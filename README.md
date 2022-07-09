# homebridge-rfxcom

Homebridge plugin for transceivers :\
[RFXtrx433E](http://www.rfxcom.com/RFXtrx433E-USB-43392MHz-Transceiver/en),\
[RFXtrx433XL](http://www.rfxcom.com/epages/78165469.sf/en_GB/?ViewObjectPath=%2FShops%2F78165469%2FProducts%2F18103).\
\
Fork forked from glefand/homebridge-rfxcom\
Itself forked from jhurliman/homebridge-rfxcom\
\
The shutter is at 50% at startup, like that you can set initialization in whatever direction you want.

## Usage

`npm install -g homebridge-pluugin-rfxcom-3`

### config.json

```
  "platforms": [
    {
      "platform": "RFXCom 3",
      "name": "RFXCom 3",
      "rfyRemotes": [
        {
          "name": "blinds",
          "deviceID": "0x000000/1"
        }
      ]
    }
  ]
```

##### platform

- **name** - mandatory\
  Name of the platform.
- **tty** - optional\
  Path of RFXCOM.\
  **default: '/dev/ttyUSB0'**
- **withSwitches** - optional\
  Create switch accessories (Up & Down).\
  **default: false**
- **debug** - optional\
  Debug mode to view RFXtrx trace.\
  For the platform debug informations prefer run Homebridge in Debug mode `-D`.\
  **default: false**

##### rfyRemotes

- **name** - mandatory\
  Display name of the remote that will appear in HomeKit.
- **deviceID** - mandatory\
  The remote address and followed by unit code that can be found in the RFXMngr setup program (Windows only).\
  **format: 0x0?????/?**
- **openCloseSeconds** - optional\
  Number of seconds it takes for the blinds/awning/etc to fully open or close.\
  If you want the good percentage displayed, fill it exactly.\
  **default: 25**