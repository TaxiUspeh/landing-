const { test } = require('node:test');
const assert = require('node:assert/strict');
const { carpoolBookingMessage } = require('./carpool-push.cjs');
test('carpool push follows booking changes without exposing contact data', () => {
  const booking={status:'confirmed',phone:'+77000000000',name:'Private',amount:1500};
  const data=carpoolBookingMessage(null,booking,'booking1');
  assert.equal(data.type,'carpool');assert.ok(data.url.endsWith('?carpool=1'));
  assert.equal(JSON.stringify(data).includes('Private'),false);assert.equal(JSON.stringify(data).includes('77000000000'),false);
  assert.equal(carpoolBookingMessage(booking,{...booking,updatedAt:1},'booking1'),null);
  assert.ok(carpoolBookingMessage(booking,{...booking,status:'cancelled'},'booking1'));
  assert.equal(carpoolBookingMessage(booking,{...booking,status:'completed'},'booking1'),null);
});
