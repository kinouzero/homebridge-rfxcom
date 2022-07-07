# homebridge-rfxcom
-----
Homebridge plugin for [RFXtrx433(E,XL)](http://www.rfxcom.com/RFXtrx433E-USB-43392MHz-Transceiver/en) transceivers.\
Fork forked from glefand/homebridge-rfxcom\
Itself forked from jhurliman/homebridge-rfxcom\
\
The shutter is at 50% at startup, like that you can set initialization in whatever direction you want.

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
   Name of the platform.
 - **tty** - optional\
   Path of RFXCOM.\
   **default: '/dev/ttyUSB0'**
 - **debug** - optional\
   Debug mode to view more informations.\
   **default: false**
 - **withSwitches** - optional\
   Create switch accessories (Up & Down)
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