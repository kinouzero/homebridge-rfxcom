# homebridge-rfxcom
-----
Homebridge plugin for [RFXtrx433(E,XL)](http://www.rfxcom.com/RFXtrx433E-USB-43392MHz-Transceiver/en) transceivers.
Fork forked from glefand/homebridge-rfxcom
Fork forked from jhurliman/homebridge-rfxcom

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
          "name": "Awning",
          "deviceID": "0x010000/1",
          "openCloseSeconds": 18
        }
      ]
    }
  ]
```

##### rfyRemotes

 - **name** - Display name of the remote that will appear in HomeKit
 - **deviceID** - The remote address and followed by unit code that can be found
   in the RFXMngr setup program (Windows only).
 - **openCloseSeconds** - Number of seconds it takes for the blinds/awning/etc
   to fully open or close. If you want the good percentage of overture, fill it exactly
   (by default **25**)
