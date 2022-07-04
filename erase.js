#!/usr/bin/env node
'use strict';

const rfxcom = require('rfxcom');

let rfxtrx = new rfxcom.RfxCom('/dev/ttyRFXCOM', {debug: true}),
    rfy    = new rfxcom.Rfy(rfxtrx, rfxcom.rfy.RFY);

rfy.erase('0x000000/1', function(err, res, sequenceNumber) {
  if(!err) console.log('complete');
});
