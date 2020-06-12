#!/usr/bin/env node

var rfxcom = require('./node_modules/rfxcom');

var rfxtrx = new rfxcom.RfxCom("/dev/ttyRFXCOM", {debug: true}),
rfy = new rfxcom.Rfy(rfxtrx, rfxcom.rfy.RFY);

rfy.program("0x9BC01/1", function(err, res, sequenceNumber) {
          if (!err) console.log('complete');
});
