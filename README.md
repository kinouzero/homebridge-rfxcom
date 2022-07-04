# homebridge-rfxcom
-----
Homebridge plugin for [RFXtrx433(E,XL)](http://www.rfxcom.com/RFXtrx433E-USB-43392MHz-Transceiver/en) transceivers.\
Fork forked from glefand/homebridge-rfxcom\
Itself forked from jhurliman/homebridge-rfxcom\
\
The shutter is at 50% at startup, like that you can press any button to set initialization.

## Usage

`npm install -g homebridge-rfxcom3`

### config.json
```
  "platforms": [
    {
      "platform": "RFXCom",
      "name": "RFXCom",
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
   Name of the platform
 - **tty** - optional - default: **'/dev/ttyUSB0'**\
   Path of RFXCOM
 - **debug** - optional - default: **false**

##### rfyRemotes

 - **name** - mandatory\
   Display name of the remote that will appear in HomeKit
 - **deviceID** - mandatory - format: **0x0?????/?**\
   The remote address and followed by unit code that can be found in the RFXMngr setup program (Windows only).
 - **openCloseSeconds** - optional - default: **25**\
   Number of seconds it takes for the blinds/awning/etc to fully open or close.\
   If you want the good percentage displayed, fill it exactly.