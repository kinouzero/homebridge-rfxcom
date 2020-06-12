#!/usr/bin/env node
'use strict';

const rfxcom = require('node_modules/rfxcom');
rfxtrx = new rfxcom.RfxCom('/dev/ttyRFXCOM', {debug: true}),
   rfy = new rfxcom.Rfy(rfxtrx, rfxcom.rfy.RFY);

rfy.erase('0x09BC01/1', function(err, res, sequenceNumber) {
  if (!err) console.log('complete');
});
