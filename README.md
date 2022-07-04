# homebridge-rfxcom
-----
Homebridge plugin for [RFXtrx433(E,XL)](http://www.rfxcom.com/RFXtrx433E-USB-43392MHz-Transceiver/en) transceivers.\
Fork forked from glefand/homebridge-rfxcom\
Itself forked from jhurliman/homebridge-rfxcom\
\
The shutter is at 50% at startup, like that you can press any button to set initialization.\

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
          "deviceID": "0x010000/1",
          "openCloseSeconds": 25
        }
      ]
    }
  ]
```

##### platform

 - **name** - Name of the platform
 - **tty** - path of RFXCOM - optional (by default: **'/dev/ttyUSB0'**).
 - **debug** - optional (by default **false**).

##### rfyRemotes

 - **name** - Display name of the remote that will appear in HomeKit - mandatory
 - **deviceID** - The remote address and followed by unit code that can be found
   in the RFXMngr setup program (Windows only). - mandatory (format: **0x0?????/?**)
 - **openCloseSeconds** - Number of seconds it takes for the blinds/awning/etc
   to fully open or close. If you want the good percentage of overture, fill it exactly
   - optional (by default: **25**)
