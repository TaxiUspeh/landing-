import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, getDocs, query, collection, where, setDoc, updateDoc } from 'firebase/firestore';
const require=createRequire(new URL('../../functions/package.json',import.meta.url));
const { initializeApp, deleteApp }=require('firebase-admin/app');
const { getFirestore, Timestamp }=require('firebase-admin/firestore');
const { createCarpoolActions }=require('./carpool.cjs');
process.env.FIRESTORE_EMULATOR_HOST='127.0.0.1:8088';
const projectId='demo-taxi-rules-check';
const app=initializeApp({projectId},'carpool-tests'),db=getFirestore(app);
const env=await initializeTestEnvironment({projectId,firestore:{host:'127.0.0.1',port:8088,rules:await readFile('../../firestore.rules','utf8')}});
class HttpsError extends Error {constructor(code,message){super(message);this.code=code;}}
let time=Date.now(),sequence=0,passed=0;
const {command}=createCarpoolActions({db,Timestamp,HttpsError,now:()=>time});
const call=(uid,action,data={},operationId=`test-operation-${++sequence}`)=>command({auth:{uid},data:{action,...data,operationId}});
const client=uid=>env.authenticatedContext(uid).firestore();
const tripFields=()=>({fromCity:'Белоусовка',toCity:'Усть-Каменогорск',departureMs:time+3600000,pickup:'Автостанция',dropoff:'Центр',totalSeats:4,seatPrice:1500,phone:'+77000000001',luggage:'Одна сумка'});
const publish=()=>call('driver','publish',tripFields());
const book=(uid,tripId,seats=1,extra={})=>call(uid,'book',{tripId,seats,expectedSeatPrice:1500,name:'Пассажир',phone:'+77000000002',...extra});
const read=async(path)=>(await db.doc(path).get()).data();
async function seed(patch={}){
 await env.clearFirestore();time=Date.now();
 await db.doc('admins/admin').set({active:true});
 await db.doc('settings/carpoolBooking').set({schemaVersion:1,hubVersion:1});
 await db.doc('drivers/30').set({driverNumber:30,name:'Водитель',car:'Лада',phone:'+77000000001',authUid:'driver',status:'active',passengerEnabled:true,passengerStatus:'active',passengerSeats:4,serviceCategories:['sedan'],carpoolEnabled:true,carpoolCommissionRate:10,commissionRate:20,debtMode:'limited',debtLimit:1000,balance:0,...patch});
 await db.doc('driverAccounts/driver').set({driverId:'30',active:true});
 await db.doc('driverStates/driver').set({driverId:'30',status:'available',activeOrderId:'',lastSeen:Timestamp.now(),updatedAt:Timestamp.now()});
}
async function test(name,fn){await seed();await fn();console.log('PASS: '+name);passed++;}
try{
 await test('backend gate, opted-in identity, capacity, dates and strict server-owned fields',async()=>{
  await assert.rejects(call('stranger','publish',tripFields()));
  await assert.rejects(call('driver','publish',{...tripFields(),totalSeats:5}));
  await assert.rejects(call('driver','publish',{...tripFields(),seatPrice:0}));
  await assert.rejects(call('driver','publish',{...tripFields(),departureMs:time-1}));
  await db.doc('drivers/30').update({carpoolEnabled:false});await assert.rejects(publish());
  await db.doc('drivers/30').update({carpoolEnabled:true});await db.doc('settings/carpoolBooking').delete();await assert.rejects(publish());
  await db.doc('settings/carpoolBooking').set({schemaVersion:1});const {tripId}=await publish();
  await assert.rejects(publish());await assert.rejects(call('stranger','edit',{tripId,...tripFields()}));
  await assertFails(updateDoc(doc(client('driver'),'carpoolTrips',tripId),{seatPrice:1}));
  await assertFails(updateDoc(doc(client('admin'),'carpoolTrips',tripId),{availableSeats:99}));
  await assertFails(updateDoc(doc(client('driver'),'drivers','30'),{carpoolEnabled:true,carpoolReservedAmount:0}));
  await assertFails(updateDoc(doc(client('admin'),'drivers','30'),{carpoolReservedAmount:0}));
  await assertSucceeds(updateDoc(doc(client('admin'),'drivers','30'),{carpoolCommissionRate:15}));
 });
 await test('competing bookings cannot oversell the last seats; retry is idempotent',async()=>{
  const {tripId}=await publish();await book('client1',tripId,3);
  const results=await Promise.allSettled([book('client2',tripId),book('client3',tripId)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal((await read('carpoolTrips/'+tripId)).availableSeats,0);
  assert.equal((await read('drivers/30')).carpoolReservedAmount,600);
  await assert.rejects(book('client4',tripId));
  const winner=results[0].status==='fulfilled'?'client2':'client3',result=results.find(r=>r.status==='fulfilled').value;
  const cancel={tripId,bookingId:result.bookingId};await call(winner,'cancelBooking',cancel,'same-cancel-operation');await call(winner,'cancelBooking',cancel,'same-cancel-operation');
  assert.equal((await read('carpoolTrips/'+tripId)).availableSeats,1);assert.equal((await read('drivers/30')).carpoolReservedAmount,450);
  const request={tripId,seats:1,expectedSeatPrice:1500,name:'Пассажир',phone:'+77000000002'};
  const a=await call('client4','book',request,'same-booking-operation');const b=await call('client4','book',request,'same-booking-operation');assert.deepEqual(a,b);
  await assert.rejects(call('client4','book',{...request,seats:2},'same-booking-operation'));
  assert.equal((await read('drivers/30')).carpoolReservedAmount,600);
 });
 await test('price freezes, contacts stay private, and new or legacy bookings need no code',async()=>{
  const {tripId}=await publish();await assert.rejects(book('client1',tripId,1,{expectedSeatPrice:1000}));
  const {bookingId}=await book('client1',tripId,2);
  assert.equal(await read('carpoolBoardingCodes/'+bookingId),undefined);
  await assert.rejects(call('driver','edit',{tripId,...tripFields(),seatPrice:2000}));
  for(const name of ['carpoolContacts','carpoolBookings']) await assertFails(getDoc(doc(client('stranger'),name,bookingId)));
  await assertSucceeds(getDoc(doc(client('driver'),'carpoolContacts',bookingId)));
  await db.doc('carpoolBoardingCodes/'+bookingId).set({clientUid:'client1',code:'1234',attempts:5});
  for(const uid of ['client1','driver','stranger','admin']) await assertFails(getDoc(doc(client(uid),'carpoolBoardingCodes',bookingId)));
  const owned=query(collection(client('client1'),'carpoolBookings'),where('clientUid','==','client1'));assert.equal((await getDocs(owned)).size,1);
  const assigned=query(collection(client('driver'),'carpoolBookings'),where('driverUid','==','driver'),where('tripId','==',tripId));assert.equal((await getDocs(assigned)).size,1);
  await assert.rejects(call('driver','board',{tripId,bookingId,code:'1234'}));
  await assert.rejects(call('driver','resolve',{tripId,bookingId,outcome:'participating',reason:'Попытка'}));
  await call('admin','resolve',{tripId,bookingId,outcome:'participating',reason:'Пассажир едет'});
  assert.equal((await read('carpoolBookings/'+bookingId)).status,'confirmed');
  assert.equal(await read('carpoolBoardingCodes/'+bookingId),undefined);
 });
 await test('shared funds account for ordinary orders and carpool reservations',async()=>{
  await db.doc('drivers/30').update({balance:800});const {tripId}=await publish();
  await book('client1',tripId);await assert.rejects(book('client2',tripId));
  assert.equal((await read('drivers/30')).carpoolReservedAmount,150);
  await db.doc('drivers/30').update({balance:0});
  await db.doc('orders/taxi').set({priceAmount:5000,commissionTerms:{amount:900}});
  await db.doc('driverStates/driver').update({status:'busy',activeOrderId:'taxi'});
  await assert.rejects(book('client2',tripId));
 });
 await test('one start moves all valid bookings into trip; settlement charges once and excludes cancellations',async()=>{
  const {tripId}=await publish(),a=await book('client1',tripId,2),b=await book('client2',tripId),c=await book('client3',tripId);
  await call('client3','cancelBooking',{tripId,bookingId:c.bookingId});
  await assert.rejects(call('driver','start',{tripId}));
  await assert.rejects(call('driver','complete',{tripId}));
  time+=45*60000;
  await assert.rejects(call('client1','start',{tripId}));await assert.rejects(call('stranger','complete',{tripId}));
  await db.doc('driverStates/driver').update({status:'busy',activeOrderId:'taxi'});await assert.rejects(call('driver','start',{tripId}));
  await db.doc('driverStates/driver').update({status:'available',activeOrderId:''});await call('driver','start',{tripId});
  const started=(await read('carpoolTrips/'+tripId)).startedAt.toMillis();time+=1000;
  await call('driver','start',{tripId});assert.equal((await read('carpoolTrips/'+tripId)).startedAt.toMillis(),started);
  for(const row of [a,b])assert.equal((await read('carpoolBookings/'+row.bookingId)).status,'in_trip');
  assert.equal((await read('carpoolBookings/'+c.bookingId)).status,'cancelled');
  await assert.rejects(call('client1','cancelBooking',{tripId,bookingId:a.bookingId}));
  await assert.rejects(call('driver','cancelTrip',{tripId,reason:'Передумал'}));
  await assert.rejects(book('client4',tripId));
  assert.equal((await read('driverStates/driver')).activeOrderId,'carpool_'+tripId);
  await db.doc('drivers/30').update({carpoolCommissionRate:20,carpoolEnabled:false});
  await call('driver','complete',{tripId});await call('driver','complete',{tripId});
  const driver=await read('drivers/30');assert.equal(driver.balance,450);assert.equal(driver.carpoolReservedAmount,0);assert.equal(driver.carpoolActiveTripId,'');
  for(const row of [a,b])assert.equal((await read('carpoolBookings/'+row.bookingId)).status,'completed');
  for(const uid of ['client1','client2','client3'])assert.equal((await read('carpoolClientState/'+uid)).activeCount,0);
  const history=await read('balanceHistory/carpool_'+tripId);assert.equal(history.commissionRate,10);assert.equal(history.commissionAmount,450);assert.equal(history.difference,450);assert.equal(history.commissionBaseAmount,4500);
  assert.equal((await read('driverStates/driver')).status,'available');
 });
 await test('optional no-show dispute is excluded from start and resolved before settlement',async()=>{
  const {tripId}=await publish(),a=await book('client1',tripId,2),b=await book('client2',tripId,2);
  await call('driver','dispute',{tripId,bookingId:b.bookingId,reason:'Пассажир не отвечает'});
  time+=45*60000;await call('driver','start',{tripId});
  assert.equal((await read('carpoolBookings/'+a.bookingId)).status,'in_trip');
  assert.equal((await read('carpoolBookings/'+b.bookingId)).status,'disputed');
  await assert.rejects(call('driver','complete',{tripId}));
  await assert.rejects(call('driver','resolve',{tripId,bookingId:b.bookingId,outcome:'cancelled',reason:'Неявка'}));
  await call('admin','resolve',{tripId,bookingId:b.bookingId,outcome:'cancelled',reason:'Неявка подтверждена'});
  assert.equal((await read('drivers/30')).carpoolReservedAmount,300);
  await call('driver','complete',{tripId});assert.equal((await read('drivers/30')).balance,300);
 });
 await test('cancellation racing with start cannot charge a cancelled seat or corrupt reserves',async()=>{
  const {tripId}=await publish();await book('client1',tripId);const b=await book('client2',tripId);time+=45*60000;
  const [start,cancel]=await Promise.allSettled([call('driver','start',{tripId}),call('client2','cancelBooking',{tripId,bookingId:b.bookingId})]);
  assert.equal(start.status,'fulfilled');
  const cancelled=cancel.status==='fulfilled',expected=cancelled?150:300;
  assert.equal((await read('carpoolBookings/'+b.bookingId)).status,cancelled?'cancelled':'in_trip');
  assert.equal((await read('drivers/30')).carpoolReservedAmount,expected);
  await call('driver','complete',{tripId});await call('driver','complete',{tripId});
  assert.equal((await read('drivers/30')).balance,expected);assert.equal((await read('drivers/30')).carpoolReservedAmount,0);
 });
 await test('empty trip cannot start; dispatcher cancellation in transit releases all holds without commission',async()=>{
  const {tripId}=await publish();time+=45*60000;await assert.rejects(call('driver','start',{tripId}));
  const a=await book('client1',tripId,2);await call('driver','start',{tripId});
  await call('admin','cancelTrip',{tripId,reason:'Поломка'});await call('admin','cancelTrip',{tripId,reason:'Поломка'});
  assert.equal((await read('carpoolBookings/'+a.bookingId)).status,'cancelled');
  assert.equal((await read('drivers/30')).balance,0);assert.equal((await read('drivers/30')).carpoolReservedAmount,0);
  assert.equal((await read('driverStates/driver')).status,'available');assert.equal(await read('balanceHistory/carpool_'+tripId),undefined);
 });
 await test('legacy boarded bookings can start or finish without reading a code',async()=>{
  for(const alreadyStarted of [false,true]){
   await seed();const {tripId}=await publish(),{bookingId}=await book('client1',tripId);time+=45*60000;
   await db.doc('carpoolBookings/'+bookingId).update({status:'boarded'});
   await db.doc('carpoolBoardingCodes/'+bookingId).set({clientUid:'client1',code:'1234',attempts:5});
   if(alreadyStarted){await db.doc('carpoolTrips/'+tripId).update({status:'in_trip'});await db.doc('driverStates/driver').update({status:'busy',activeOrderId:'carpool_'+tripId});}
   else await call('driver','start',{tripId});
   await call('driver','complete',{tripId});assert.equal((await read('drivers/30')).balance,150);
   assert.equal(await read('carpoolBoardingCodes/'+bookingId),undefined);
  }
 });
 const requestFields=(extra={})=>({fromCity:'Белоусовка',toCity:'Усть-Каменогорск',departureMs:time+3600000,seats:2,name:'Пассажир',phone:'+77000000002',...extra});
 await test('passenger request validates fields, backend readiness and authenticated ownership',async()=>{
  await assert.rejects(command({data:{action:'createRequest',...requestFields(),operationId:'anonymous-test-op'}}));
  for(const patch of [{seats:0},{seats:9},{seats:1.5},{departureMs:time-1},{departureMs:time+31*86400000},{fromCity:''},{toCity:'Белоусовка'},{name:''},{phone:'123'}])await assert.rejects(call('client1','createRequest',requestFields(patch)));
  await db.doc('settings/carpoolBooking').update({hubVersion:0});await assert.rejects(call('client1','createRequest',requestFields()));
  await db.doc('settings/carpoolBooking').update({hubVersion:1});
  const {requestId}=await call('client1','createRequest',requestFields({clientUid:'stranger',status:'found',price:1}));
  const row=await read('passenger_requests/'+requestId);assert.equal(row.clientUid,'client1');assert.equal(row.status,'open');assert.equal(row.phone,undefined);assert.equal(row.name,undefined);assert.equal(row.price,undefined);
  assert.equal((await read('passenger_request_contacts/'+requestId)).phone,'+77000000002');
  assert.equal((await read('drivers/30')).balance,0);assert.equal((await read('drivers/30')).carpoolReservedAmount,undefined);
 });
 await test('request creation retries cannot duplicate and concurrent requests respect the three-active limit',async()=>{
  const fields=requestFields();const a=await call('client1','createRequest',fields,'same-request-operation');
  assert.deepEqual(await call('client1','createRequest',fields,'same-request-operation'),a);
  await assert.rejects(call('client1','createRequest',fields));
  const results=await Promise.allSettled([1,2,3,4].map(i=>call('client1','createRequest',requestFields({departureMs:time+(60+i)*60000}))));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,2);
  assert.equal((await read('passenger_request_state/client1')).activeIds.length,3);
  await call('client1','closeRequest',{requestId:a.requestId,outcome:'cancelled'});
  await call('client1','closeRequest',{requestId:a.requestId,outcome:'cancelled'});
  assert.equal((await read('passenger_request_state/client1')).activeIds.length,2);
  await call('client1','createRequest',requestFields({departureMs:time+90*60000}));
  time+=120*60000;await call('client1','createRequest',requestFields());
  assert.equal((await read('passenger_request_state/client1')).activeIds.length,1);
 });
 await test('passenger request contacts are private and only approved carpool drivers can browse demand',async()=>{
  const {requestId}=await call('client1','createRequest',requestFields());
  for(const uid of ['stranger','client2'])for(const name of ['passenger_requests','passenger_request_contacts'])await assertFails(getDoc(doc(client(uid),name,requestId)));
  for(const uid of ['client1','driver','admin'])for(const name of ['passenger_requests','passenger_request_contacts'])await assertSucceeds(getDoc(doc(client(uid),name,requestId)));
  await assertFails(getDocs(collection(client('driver'),'passenger_request_contacts')));
  for(const uid of ['client1','driver','admin'])await assertFails(updateDoc(doc(client(uid),'passenger_requests',requestId),{seats:8}));
  await assertFails(setDoc(doc(client('client1'),'passenger_requests','forged'),{clientUid:'client1',status:'open'}));
  await assertSucceeds(getDocs(query(collection(client('driver'),'passenger_requests'),where('status','==','open'))));
  await assertSucceeds(getDocs(query(collection(client('client1'),'passenger_requests'),where('clientUid','==','client1'))));
  for(const patch of [{carpoolEnabled:false},{passengerEnabled:false},{passengerStatus:'blocked'},{status:'blocked'}]){
   await db.doc('drivers/30').update(patch);
   await assertFails(getDoc(doc(client('driver'),'passenger_requests',requestId)));
   await assertFails(getDoc(doc(client('driver'),'passenger_request_contacts',requestId)));
   await db.doc('drivers/30').update({carpoolEnabled:true,passengerEnabled:true,passengerStatus:'active',status:'active'});
  }
  await db.doc('driverAccounts/driver').update({active:false});await assertFails(getDoc(doc(client('driver'),'passenger_requests',requestId)));
  await db.doc('driverAccounts/driver').update({active:true});await db.doc('passenger_requests/'+requestId).update({departureAt:Timestamp.fromMillis(Date.now()-60000)});
  await assertFails(getDoc(doc(client('driver'),'passenger_request_contacts',requestId)));
 });
 await test('closing a request hides contacts, releases the request slot and requires owner or dispatcher',async()=>{
  const {requestId}=await call('client1','createRequest',requestFields());
  for(const uid of ['driver','stranger'])await assert.rejects(call(uid,'closeRequest',{requestId,outcome:'found'}));
  await call('admin','closeRequest',{requestId,outcome:'found'});
  assert.equal((await read('passenger_requests/'+requestId)).status,'found');assert.equal(await read('passenger_request_contacts/'+requestId),undefined);
  assert.deepEqual((await read('passenger_request_state/client1')).activeIds,[]);
  await assertFails(getDoc(doc(client('driver'),'passenger_requests',requestId)));
 });
 await test('a booked ride closes only its selected matching request atomically',async()=>{
  const {tripId}=await publish(),{requestId}=await call('client1','createRequest',requestFields());
  await assert.rejects(book('client2',tripId,2,{requestId}));await assert.rejects(book('client1',tripId,1,{requestId}));
  assert.equal((await read('carpoolTrips/'+tripId)).availableSeats,4);
  const {bookingId}=await book('client1',tripId,2,{requestId});
  const row=await read('passenger_requests/'+requestId);assert.equal(row.status,'matched');assert.equal(row.bookingId,bookingId);assert.equal(row.tripId,tripId);
  assert.equal((await read('carpoolBookings/'+bookingId)).requestId,requestId);
  assert.equal((await read('carpoolTrips/'+tripId)).availableSeats,2);assert.equal((await read('drivers/30')).carpoolReservedAmount,300);
  assert.deepEqual((await read('passenger_request_state/client1')).activeIds,[]);
  assert.equal(await read('passenger_request_contacts/'+requestId),undefined);
  await assertSucceeds(getDoc(doc(client('driver'),'carpoolContacts',bookingId)));
 });
 await test('request cancellation racing with booking cannot leave a false match or reserve extra seats',async()=>{
  const {tripId}=await publish(),{requestId}=await call('client1','createRequest',requestFields());
  const [booking]=await Promise.allSettled([book('client1',tripId,2,{requestId}),call('client1','closeRequest',{requestId,outcome:'cancelled'})]);
  const matched=booking.status==='fulfilled';assert.equal((await read('passenger_requests/'+requestId)).status,matched?'matched':'cancelled');
  assert.equal((await read('carpoolTrips/'+tripId)).availableSeats,matched?2:4);
  assert.equal((await read('drivers/30')).carpoolReservedAmount||0,matched?300:0);
  assert.deepEqual((await read('passenger_request_state/client1')).activeIds,[]);
 });
 console.log(`ALL ${passed} CARPOOL CHECKS PASSED`);
}finally{await env.cleanup();await deleteApp(app);}
