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
 await db.doc('settings/carpoolBooking').set({schemaVersion:1});
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
 await test('price freezes, contacts and boarding code stay private, invalid code attempts are limited',async()=>{
  const {tripId}=await publish();await assert.rejects(book('client1',tripId,1,{expectedSeatPrice:1000}));
  const {bookingId}=await book('client1',tripId,2);
  await assert.rejects(call('driver','edit',{tripId,...tripFields(),seatPrice:2000}));
  for(const name of ['carpoolContacts','carpoolBookings','carpoolBoardingCodes']) await assertFails(getDoc(doc(client('stranger'),name,bookingId)));
  await assertSucceeds(getDoc(doc(client('driver'),'carpoolContacts',bookingId)));
  await assertFails(getDoc(doc(client('driver'),'carpoolBoardingCodes',bookingId)));
  await assertSucceeds(getDoc(doc(client('client1'),'carpoolBoardingCodes',bookingId)));
  const owned=query(collection(client('client1'),'carpoolBookings'),where('clientUid','==','client1'));assert.equal((await getDocs(owned)).size,1);
  const assigned=query(collection(client('driver'),'carpoolBookings'),where('driverUid','==','driver'),where('tripId','==',tripId));assert.equal((await getDocs(assigned)).size,1);
  time+=45*60000;
  for(let i=0;i<5;i++) assert.ok((await call('driver','board',{tripId,bookingId,code:'0000'})).error);
  const code=(await read('carpoolBoardingCodes/'+bookingId)).code;await assert.rejects(call('driver','board',{tripId,bookingId,code}));
  await assert.rejects(call('driver','resolve',{tripId,bookingId,outcome:'boarded',reason:'Попытка'}));
  await call('admin','resolve',{tripId,bookingId,outcome:'boarded',reason:'Пассажир подтвердил посадку'});
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
 await test('boarding, ordinary-trip conflict, one settlement and release of reserves',async()=>{
  const {tripId}=await publish(),{bookingId}=await book('client1',tripId,3);
  time+=45*60000;const code=(await read('carpoolBoardingCodes/'+bookingId)).code;
  await call('driver','board',{tripId,bookingId,code});
  await assert.rejects(call('client1','cancelBooking',{tripId,bookingId}));
  await assert.rejects(call('driver','cancelTrip',{tripId,reason:'Передумал'}));
  await db.doc('driverStates/driver').update({status:'busy',activeOrderId:'taxi'});await assert.rejects(call('driver','start',{tripId}));
  await db.doc('driverStates/driver').update({status:'available',activeOrderId:''});await call('driver','start',{tripId});
  assert.equal((await read('driverStates/driver')).activeOrderId,'carpool_'+tripId);
  await db.doc('drivers/30').update({carpoolCommissionRate:20,carpoolEnabled:false});
  await call('driver','complete',{tripId});await call('driver','complete',{tripId});
  const driver=await read('drivers/30');assert.equal(driver.balance,450);assert.equal(driver.carpoolReservedAmount,0);assert.equal(driver.carpoolActiveTripId,'');
  assert.equal((await read('carpoolBookings/'+bookingId)).status,'completed');assert.equal((await read('carpoolClientState/client1')).activeCount,0);
  const history=await read('balanceHistory/carpool_'+tripId);assert.equal(history.commissionRate,10);assert.equal(history.commissionAmount,450);assert.equal(history.difference,450);
  assert.equal((await read('driverStates/driver')).status,'available');
 });
 await test('disputed no-show is resolved by dispatcher, and cancellation releases seats once',async()=>{
  const {tripId}=await publish(),a=await book('client1',tripId,2),b=await book('client2',tripId,2);
  await call('driver','dispute',{tripId,bookingId:b.bookingId,reason:'Пассажир не отвечает'});
  await assert.rejects(call('driver','resolve',{tripId,bookingId:b.bookingId,outcome:'cancelled',reason:'Неявка'}));
  await call('admin','resolve',{tripId,bookingId:b.bookingId,outcome:'cancelled',reason:'Неявка подтверждена'});
  assert.equal((await read('carpoolTrips/'+tripId)).availableSeats,2);assert.equal((await read('drivers/30')).carpoolReservedAmount,300);
  await call('driver','cancelTrip',{tripId,reason:'Поломка'});await call('driver','cancelTrip',{tripId,reason:'Поломка'});
  assert.equal((await read('carpoolBookings/'+a.bookingId)).status,'cancelled');assert.equal((await read('drivers/30')).carpoolReservedAmount,0);
  assert.equal((await read('drivers/30')).balance,0);
 });
 console.log(`ALL ${passed} CARPOOL CHECKS PASSED`);
}finally{await env.cleanup();await deleteApp(app);}
