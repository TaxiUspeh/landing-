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

const { mayReceivePassengerRequest, passengerRequestMessage, createPassengerRequestPush } = require('./carpool-push.cjs');
const stamp=value=>({toMillis:()=>value});
function pushFixture() {
  const now=1000000, records=new Map(), messages=[];
  const row={status:'open',createdAt:stamp(now-1000),departureAt:stamp(now+600000),name:'PRIVATE',phone:'PRIVATE_PHONE'};
  records.set('passenger_requests/r1',row);
  for(const token of ['a','b'])records.set(`driverPushTokens/${token}`,{token});
  const db={doc(path){return{path,get:async()=>({data:()=>records.get(path)}),set:async(value,options)=>records.set(path,options?.merge?{...records.get(path),...value}:value)};},
    async runTransaction(fn){return fn({get:ref=>ref.get(),set:(ref,value)=>records.set(ref.path,value),delete:ref=>records.delete(ref.path)});}};
  let results;
  const send=createPassengerRequestPush({db,Timestamp:{fromMillis:stamp},now:()=>now,
    eligibleSubscriptions:async(_uid,_order,accepts)=>{
      assert.equal(accepts,mayReceivePassengerRequest);
      return [...records].filter(([path])=>path.startsWith('driverPushTokens/')).map(([path,value])=>({ref:db.doc(path),data:()=>value}));
    },messaging:{async sendEachForMulticast(message){messages.push(message);return{responses:results||message.tokens.map(()=>({success:true}))};}}});
  return{send,records,messages,row,setResults:value=>{results=value;},event:{params:{requestId:'r1'},data:{data:()=>row}}};
}
test('passenger request notifications require the active carpool direction and contain no contacts or route',()=>{
  const active={status:'active',carpoolEnabled:true};
  assert.equal(mayReceivePassengerRequest(active),true);
  for(const patch of [{status:'blocked'},{carpoolEnabled:false},{passengerEnabled:false},{passengerStatus:'paused'}])assert.equal(mayReceivePassengerRequest({...active,...patch}),false);
  const row={status:'open',createdAt:stamp(1000),departureAt:stamp(999999),phone:'PRIVATE_PHONE',fromCity:'PRIVATE_ADDRESS'};
  const message=passengerRequestMessage(row,'r1',2000);
  assert.equal(message.type,'passenger_request');assert.equal(message.requestId,'r1');assert.match(message.url,/request=r1/);
  assert.doesNotMatch(JSON.stringify(message),/PRIVATE/);
  assert.equal(passengerRequestMessage({...row,status:'cancelled'},'r1',2000),null);
  assert.equal(passengerRequestMessage(row,'r1',400000),null);
  assert.equal(passengerRequestMessage({...row,departureAt:stamp(1000)},'r1',2000),null);
});
test('replayed request events send once; closed requests never send',async()=>{
  const f=pushFixture();await f.send(f.event);await f.send(f.event);
  assert.equal(f.messages.length,1);assert.deepEqual(f.messages[0].tokens,['a','b']);
  const closed=pushFixture();closed.records.set('passenger_requests/r1',{...closed.row,status:'cancelled'});await closed.send(closed.event);assert.equal(closed.messages.length,0);
});
test('retry targets only failed tokens and removes permanently invalid registrations',async()=>{
  const f=pushFixture();f.setResults([{success:true},{success:false,error:{code:'messaging/internal-error'}}]);await assert.rejects(f.send(f.event));
  f.setResults([{success:true}]);await f.send(f.event);assert.deepEqual(f.messages[1].tokens,['b']);
  await f.send(f.event);assert.equal(f.messages.length,2);
  const bad=pushFixture();bad.setResults([{success:true},{success:false,error:{code:'messaging/registration-token-not-registered'}}]);await bad.send(bad.event);
  assert.equal(bad.records.has('driverPushTokens/b'),false);await bad.send(bad.event);assert.equal(bad.messages.length,1);
});
