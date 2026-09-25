import { confirmSoberExpenses } from '../../sober-dispatch.js';
import { offerFields, priceSettings, increaseOrderPrice } from '../../customer-pricing.js';
import { allowedOrderServices } from '../../functions/driver-services.mjs';
import { assignmentVehicle } from '../../functions/driver-services.mjs';
import { retryPriceConflict } from '../../customer-pricing.js';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import * as sdk from 'firebase/firestore';
import * as finance from '../../driver-finance.js';
import * as auction from '../../auction-core.js';
import { driverCanServeOrder, validVehicleProfile } from '../../vehicle-categories.js';
const { doc, getDoc, setDoc, updateDoc, writeBatch, serverTimestamp, Timestamp } = sdk;
const env = await initializeTestEnvironment({ projectId:'demo-taxi-rules-check',firestore:{host:'127.0.0.1',port:8088,rules:await readFile('../../firestore.rules','utf8')} });
const databases = new Map();
const db = uid => { if (!databases.has(uid)) databases.set(uid, env.authenticatedContext(uid).firestore()); return databases.get(uid); };
const driverSource = await readFile('../../driver-portal.js','utf8'), dispatcherSource = await readFile('../../dispatcher.js','utf8');
function extract(source, name) { const match = new RegExp('(?:async )?function '+name+'\\(').exec(source); assert.ok(match,name); const tail=source.slice(match.index); const next=tail.slice(1).search(/\n(?:async )?function /); return next<0?tail:tail.slice(0,next+1); }
let passed=0;
const active = new Set(['accepted','en_route','arrived','in_trip']);
async function seed(financial={commissionRate:20,debtMode:'limited',debtLimit:1000}, balance=-100) {
 await env.clearFirestore();
 await env.withSecurityRulesDisabled(async ctx=> {const d=ctx.firestore(),batch=writeBatch(d);
 batch.set(doc(d,'admins','admin'),{active:true});
 batch.set(doc(d,'drivers','d-a'),{driverNumber:1,name:'Driver',phone:'',car:'',color:'',authUid:'driver-a',status:'active',balance,...financial});
 batch.set(doc(d,'driverAccounts','driver-a'),{driverId:'d-a',active:true});
 batch.set(doc(d,'driverStates','driver-a'),{driverId:'d-a',status:'available',activeOrderId:'',lastSeen:Timestamp.now(),updatedAt:Timestamp.now()});await batch.commit();});
 await order('order-a');
}
async function order(id, overrides={}) { return setDoc(doc(db('client'),'orders',id),{orderNumber:'TU-FINANCE',serviceType:'taxi',source:'online',clientUid:'client',fromAddress:'A',toAddress:'B',stops:[],wishes:'',scheduledFor:'',direction:'',priceText:'5000 ₸',priceAmount:5000,status:'searching',createdAt:serverTimestamp(),updatedAt:serverTimestamp(),...overrides}); }
async function run(name, uid, args=[], overrides={}) {
 const database=db(uid),profile=(await getDoc(doc(db('admin'),'drivers','d-a'))).data();
 const messages=[];
 const context={document:{getElementById:id=>id==='existing-driver-number'?{value:'1'}:{}},drivers:[{id:'d-a',...profile}],driverDirectory:'cargo',assignmentVehicle,cargoServicesReady:true,retryPriceConflict,...sdk,...finance,...auction,driverCanServeOrder,validVehicleProfile,ensureUidAvailable:async()=>{},parseBalance:value=>Number(value),validateUid:()=>true,db:database,currentUser:{uid},currentDriver:profile,currentDriverId:'d-a',currentCanTakeOrders:finance.hasOrderFunds(profile),currentBaseEligible:finance.hasOrderFunds(profile),orderActionInProgress:false,dispatcherCompletionInProgress:false,manualOrderAssignmentInProgress:false,
 ACTIVE_ORDER_STATUSES:active,CANCELLABLE_ORDER_STATUSES:new Set([...active,'searching','bidding']),REQUEUEABLE_ORDER_STATUSES:new Set(['accepted','en_route','arrived']),REQUEUE_REASONS:[['car_issue','Неисправность автомобиля']],AVAILABLE_DRIVER_STATE:{status:'available',activeOrderId:''},
 window:{confirm:()=>true},console:{warn:()=>{},error:()=>{}},elements:{onlineOrdersMessage:{}},
 renderOnlineOrders:()=>{},showOrdersMessage:(message,success)=>messages.push({message,success}),setMessage:(el,message,success)=>messages.push({message,success}),formatMoney:value=>String(value)+' ₸',normalizeUid:value=>value,
 normalizedDriverState:snapshot=>({...snapshot.data(),exists:snapshot.exists()}),findManualAssignmentDriver:()=>({...profile,id:'d-a'}),driverAvailabilityInfo:()=>({key:'available'}),args,...overrides};
 const source=['acceptOrder','advanceOrder','returnOrderToSearch','sendAuctionOffer'].includes(name)?driverSource:dispatcherSource;
 await Function(...Object.keys(context), extract(source,name)+'; return '+name+'(...args);')(...Object.values(context));
 const result = messages.at(-1); if (result && !result.success && result.message) console.log('ACTION RESULT:', name, result.message); return result;
}
const readOrder=async(id='order-a')=>(await getDoc(doc(db('admin'),'orders',id))).data();
const readDriver=async()=>(await getDoc(doc(db('admin'),'drivers','d-a'))).data();
async function settings(patch) {
 const d=db('admin'),ref=doc(d,'drivers','d-a'),before=(await getDoc(ref)).data(),after={...before,...patch};
 const batch=writeBatch(d),history=doc(sdk.collection(d,'driverFinanceHistory'));
 batch.update(ref,{...patch,financeChangeId:history.id});
 batch.set(history,{driverId:'d-a',previous:finance.financeSettings(before),next:finance.financeSettings(after),changedAt:serverTimestamp(),changedBy:'admin'});return batch.commit();
}
async function arriveComplete() {assert.ok((await run('advanceOrder','driver-a',['order-a','accepted','arrived'])).success);return run('advanceOrder','driver-a',['order-a','arrived','completed']);}
async function test(name, fn) {await seed();await fn();console.log('PASS: '+name);passed++;}
async function soberOrder(overrides={}) {
 await sdk.deleteDoc(doc(db('admin'),'orders','order-a'));
 await updateDoc(doc(db('admin'),'drivers','d-a'),{soberDriverEnabled:true});
 await setDoc(doc(db('admin'),'settings','soberDriverBooking'),{schemaVersion:1});
 await order('order-a',{serviceType:'soberDriver',serviceDetails:{carModel:'Toyota',transmission:'manual'},
   ...offerFields(5000,null,'soberDriver',priceSettings(),'sober_route'),priceUpdatedAt:serverTimestamp(),
   soberFare:{schemaVersion:1,base:'Белоусовка',pickupAmount:1000,returnAmount:1000},...overrides});
}
try {
 await test('sober online create, opt-in queries, acceptance and completion charge only work once',async()=>{
  await soberOrder();
  await updateDoc(doc(db('admin'),'drivers','d-a'),{soberDriverEnabled:false});
  await assertFails(getDoc(doc(db('driver-a'),'orders','order-a')));
  const ordinaryQuery=sdk.query(sdk.collection(db('driver-a'),'orders'),sdk.where('status','==','searching'),sdk.where('serviceType','in',allowedOrderServices({})));
  assert.equal((await sdk.getDocs(ordinaryQuery)).size,0);
  await assertFails(updateDoc(doc(db('driver-a'),'drivers','d-a'),{soberDriverEnabled:true}));
  await updateDoc(doc(db('admin'),'drivers','d-a'),{soberDriverEnabled:true});
  assert.ok((await getDoc(doc(db('driver-a'),'orders','order-a'))).exists());
  assert.ok((await run('acceptOrder','driver-a',['order-a'])).success);
  assert.deepEqual((await readOrder()).commissionTerms,{rate:20,baseAmount:3000,amount:600});
  await assertFails(updateDoc(doc(db('admin'),'orders','order-a'),{soberFare:{schemaVersion:1,base:'Белоусовка',pickupAmount:0,returnAmount:0}}));
  assert.ok((await arriveComplete()).success);assert.equal((await readDriver()).balance,500);assert.equal((await readOrder()).commissionBaseAmount,3000);
  assert.ok(!(await run('advanceOrder','driver-a',['order-a','arrived','completed'])).success);assert.equal((await readDriver()).balance,500);
 });
 await test('sober own price is saved without geocoding, then expenses confirmed and commission reserved',async()=>{
  await soberOrder({...offerFields(null,4000,'soberDriver',priceSettings()),soberFare:{schemaVersion:1,base:'Белоусовка',pickupAmount:null,returnAmount:null},fromAddress:'Чапаева көшесі, у трассы'});
  assert.ok(!(await run('acceptOrder','driver-a',['order-a'])).success);
  await assert.rejects(confirmSoberExpenses(db('admin'),sdk,{orderId:'order-a',uid:'admin',pickupAmount:2500,returnAmount:2500}));
  await assertFails(updateDoc(doc(db('client'),'orders','order-a'),{soberFare:{schemaVersion:1,base:'Белоусовка',pickupAmount:1000,returnAmount:1000}}));
  await confirmSoberExpenses(db('admin'),sdk,{orderId:'order-a',uid:'admin',pickupAmount:1000,returnAmount:1000});
  assert.equal((await readOrder()).priceAmount,4000);assert.ok((await run('assignOrderManually','admin',['order-a','d-a'])).success);
 });
 await test('sober price increase freezes taxi expenses; dispatcher completion uses the work base',async()=>{
  await soberOrder();
  await increaseOrderPrice(db('client'),sdk,{orderId:'order-a',uid:'client',amount:6000,operationId:'sober-increase'});
  assert.equal((await readOrder()).soberFare.pickupAmount,1000);
  assert.ok((await run('acceptOrder','driver-a',['order-a'])).success);
  assert.equal((await readOrder()).commissionTerms.baseAmount,4000);
  assert.ok((await run('completeOnlineOrder','admin',[{id:'order-a',...await readOrder()}])).success);
  assert.equal((await readOrder()).commissionBaseAmount,4000);assert.equal((await readDriver()).balance,700);
 });
 await test('sober payload rejects missing model, bogus expenses and prices below minimum',async()=>{
  await soberOrder();
  const base={...await readOrder(),createdAt:serverTimestamp(),updatedAt:serverTimestamp(),priceUpdatedAt:serverTimestamp()};
  for(const offered of [null,6000]) await setDoc(doc(db('client'),'orders',`full-sober-${offered}`),{...base,...offerFields(5000,offered,'soberDriver',priceSettings(),'sober_route'),stops:Array(5).fill('Остановка'),routeCoordinates:Array(7).fill({lat:50.132,lon:82.533}),wishes:'Ориентир '.repeat(50)});
  for(const point of [{lat:'50.132',lon:82.533},{lat:true,lon:82.533},{lat:50.132},{lat:91,lon:82.533},{lat:50.132,lon:181},{lat:50.132,lon:82.533,other:0},'invalid-coordinate']) await assertFails(setDoc(doc(db('client'),'orders','bad-point'),{...base,routeCoordinates:[point,null]}));
  for(const patch of [{serviceDetails:{carModel:'',transmission:'manual'}},{soberFare:{schemaVersion:1,base:'Белоусовка',pickupAmount:-1,returnAmount:1000}},{soberFare:{schemaVersion:1,base:'Белоусовка',pickupAmount:4000,returnAmount:1000}},{priceAmount:1000,priceText:'1000 ₸',finalDisplayedPrice:1000,calculatedPrice:1000}]) await assertFails(setDoc(doc(db('client'),'orders','bad-sober'),{...base,...patch}));
 });
 await test('zero-price orders cannot be created by clients or dispatchers',async()=>{
  await assertFails(order('zero-price',{priceAmount:0,priceText:'Стоимость уточняется'}));
  await assertFails(setDoc(doc(db('admin'),'orders','zero-manual'),{...await readOrder(),source:'dispatcher',clientUid:'',priceAmount:0}));
 });
 await test('an old zero-price order cannot be accepted even by a driver with 0% commission',async()=>{
  await settings({commissionRate:0});
  await env.withSecurityRulesDisabled(ctx=>updateDoc(doc(ctx.firestore(),'orders','order-a'),{priceAmount:0,priceText:'Стоимость уточняется'}));
  assert.ok(!(await run('acceptOrder','driver-a',['order-a'])).success);
  const d=db('driver-a'),batch=writeBatch(d);
  batch.update(doc(d,'orders','order-a'),{status:'accepted',assignedDriverUid:'driver-a',assignedDriverId:'d-a',driverName:'Driver',driverPhone:'',driverCar:'',driverColor:'',acceptedAt:serverTimestamp(),updatedAt:serverTimestamp(),commissionTerms:{rate:0,baseAmount:0,amount:0}});
  batch.update(doc(d,'driverStates','driver-a'),{status:'busy',activeOrderId:'order-a',lastSeen:serverTimestamp(),updatedAt:serverTimestamp()});
  await assertFails(batch.commit());
 });
 await test('5000 fare, 100 credit: limit 1000 allows, commission reserved until completion',async()=>{
  assert.ok((await run('acceptOrder','driver-a',['order-a'])).success);
  assert.deepEqual((await readOrder()).commissionTerms,{rate:20,baseAmount:5000,amount:1000});
  assert.equal((await readDriver()).balance,-100);
  assert.equal(finance.reservedCommission([await readOrder()]),1000);
  assert.ok((await arriveComplete()).success);
  assert.equal((await readDriver()).balance,900);assert.equal(finance.reservedCommission([await readOrder()]),0);
  const retry=await run('advanceOrder','driver-a',['order-a','arrived','completed']);assert.ok(!retry.success);assert.equal((await readDriver()).balance,900);
 });
 await test('limits none and 500 reject expensive acceptance in app and direct SDK',async()=>{
  for(const patch of [{debtMode:'none',debtLimit:0},{debtMode:'limited',debtLimit:500}]){
   await settings(patch);assert.ok(!(await run('acceptOrder','driver-a',['order-a'])).success);
   const batch=writeBatch(db('driver-a'));
   batch.update(doc(db('driver-a'),'orders','order-a'),{status:'accepted',assignedDriverUid:'driver-a',assignedDriverId:'d-a',driverName:'Driver',driverPhone:'',driverCar:'',driverColor:'',acceptedAt:serverTimestamp(),updatedAt:serverTimestamp(),commissionTerms:{rate:20,baseAmount:5000,amount:1000}});
   batch.update(doc(db('driver-a'),'driverStates','driver-a'),{status:'busy',activeOrderId:'order-a',lastSeen:serverTimestamp(),updatedAt:serverTimestamp()});await assertFails(batch.commit());
  }
 });
 await test('configured drivers cannot bypass reservation with an older client',async()=>{
  const batch=writeBatch(db('driver-a'));
  batch.update(doc(db('driver-a'),'orders','order-a'),{status:'accepted',assignedDriverUid:'driver-a',assignedDriverId:'d-a',driverName:'Driver',driverPhone:'',driverCar:'',driverColor:'',acceptedAt:serverTimestamp(),updatedAt:serverTimestamp()});
  batch.update(doc(db('driver-a'),'driverStates','driver-a'),{status:'busy',activeOrderId:'order-a',lastSeen:serverTimestamp(),updatedAt:serverTimestamp()});await assertFails(batch.commit());
 });
 await test('percentage and limit changes cannot change or block an active trip',async()=>{
  await settings({commissionRate:15});assert.ok((await run('acceptOrder','driver-a',['order-a'])).success);
  await settings({commissionRate:30,debtMode:'none',debtLimit:0});
  assert.ok((await arriveComplete()).success);assert.equal((await readDriver()).balance,650);assert.equal((await readOrder()).commissionRate,15);
  await order('order-b');assert.ok(!(await run('acceptOrder','driver-a',['order-b']))?.success);
 });
 await test('exact limit still shows open orders; recorded top-up restores acceptance',async()=>{
  await updateDoc(doc(db('admin'),'drivers','d-a'),{balance:0});await run('acceptOrder','driver-a',['order-a']);await arriveComplete();
  await order('order-b');assert.equal((await readDriver()).balance,1000);
  assert.ok((await sdk.getDocs(sdk.query(sdk.collection(db('driver-a'),'orders'),sdk.where('status','==','searching'),sdk.where('serviceType','==','taxi')))).size > 0);
  await updateDoc(doc(db('admin'),'drivers','d-a'),{balance:0});
  assert.ok((await run('acceptOrder','driver-a',['order-b'])).success);
 });
 await test('return to search releases reservation and next acceptance uses new rate',async()=>{
  await run('acceptOrder','driver-a',['order-a']);
  assert.ok((await run('returnOrderToSearch','driver-a',['order-a','accepted','car_issue'])).success);
  assert.equal((await readOrder()).commissionTerms,null);assert.equal((await readDriver()).balance,-100);
  await settings({commissionRate:5});assert.ok((await run('acceptOrder','driver-a',['order-a'])).success);
  assert.equal((await readOrder()).commissionTerms.amount,250);
 });
 await test('dispatcher assignment and completion use the same reservation and percentage',async()=>{
  await settings({commissionRate:30});assert.ok(!(await run('assignOrderManually','admin',['order-a','d-a'])).success);
  await settings({commissionRate:5});assert.ok((await run('assignOrderManually','admin',['order-a','d-a'])).success);
  assert.ok((await run('completeOnlineOrder','admin',[{id:'order-a',...await readOrder()}])).success);
  assert.equal((await readDriver()).balance,150);assert.equal((await readOrder()).commissionRate,5);
 });
 await test('dispatcher cancellation releases the reservation without charging',async()=>{
  await run('acceptOrder','driver-a',['order-a']);
  assert.ok((await run('cancelOnlineOrder','admin',[{id:'order-a',...await readOrder()}])).success);
  assert.equal(finance.reservedCommission([await readOrder()]),0);assert.equal((await readDriver()).balance,-100);
 });
 await test('only dispatcher may change terms; audit is atomic, immutable and private',async()=>{
  await assertFails(updateDoc(doc(db('driver-a'),'drivers','d-a'),{commissionRate:5}));
  await assertFails(updateDoc(doc(db('admin'),'drivers','d-a'),{commissionRate:5}));
  await settings({commissionRate:5});const profile=await readDriver();
  const ref=doc(db('admin'),'driverFinanceHistory',profile.financeChangeId);assert.equal((await getDoc(ref)).data().next.commissionRate,5);
  await assertFails(updateDoc(ref,{changedBy:'other'}));await assertFails(getDoc(doc(db('client'),'driverFinanceHistory',profile.financeChangeId)));
  for(const patch of [{commissionRate:-1},{commissionRate:101},{commissionRate:5.5},{debtMode:'limited',debtLimit:-1},{debtMode:'none',debtLimit:100}])await assertFails(settings(patch));
 });
 await test('auction locks rate at selection and checks latest funds without disclosing balance',async()=>{
  await order('auction',{serviceType:'auction',proposedPrice:5000,auctionRound:1,status:'bidding'});
  let message=await run('sendAuctionOffer','driver-a',[{id:'auction',auctionRound:1},5000,5]);assert.ok(message.success,message.message);
  let offer=(await getDoc(doc(db('driver-a'),'auctionOffers','auction_driver-a'))).data();assert.equal(offer.commissionRate,20);
  await settings({commissionRate:30});await assertFails(auction.selectAuctionOffer(db('client'),sdk,'auction',offer,'client'));
  await settings({commissionRate:5});message=await run('sendAuctionOffer','driver-a',[{id:'auction',auctionRound:1},5000,5]);assert.ok(message.success,message.message);
  offer=(await getDoc(doc(db('driver-a'),'auctionOffers','auction_driver-a'))).data();
  await updateDoc(doc(db('admin'),'drivers','d-a'),{balance:900});await assertFails(auction.selectAuctionOffer(db('client'),sdk,'auction',offer,'client'));
  await updateDoc(doc(db('admin'),'drivers','d-a'),{balance:0});await auction.selectAuctionOffer(db('client'),sdk,'auction',offer,'client');
  assert.deepEqual((await readOrder('auction')).commissionTerms,{rate:5,baseAmount:5000,amount:250});await assertFails(getDoc(doc(db('client'),'drivers','d-a')));
 });
 await test('two simultaneous acceptances reserve only one trip',async()=>{
  await order('order-b');
  const results=await Promise.all([run('acceptOrder','driver-a',['order-a']),run('acceptOrder','driver-a',['order-b'])]);
  assert.equal(results.filter(result=>result?.success).length,1);
  const orders=[await readOrder(),await readOrder('order-b')];assert.equal(orders.filter(order=>order.status==='accepted').length,1);assert.equal(finance.reservedCommission(orders),1000);
 });
 await test('forged reservation and locked rate edits are rejected',async()=>{
  const d=db('driver-a'),batch=writeBatch(d);
  batch.update(doc(d,'orders','order-a'),{status:'accepted',assignedDriverUid:'driver-a',assignedDriverId:'d-a',driverName:'Driver',driverPhone:'',driverCar:'',driverColor:'',acceptedAt:serverTimestamp(),updatedAt:serverTimestamp(),commissionTerms:{rate:0,baseAmount:5000,amount:0}});
  batch.update(doc(d,'driverStates','driver-a'),{status:'busy',activeOrderId:'order-a',lastSeen:serverTimestamp(),updatedAt:serverTimestamp()});await assertFails(batch.commit());
  await run('acceptOrder','driver-a',['order-a']);
  for(const uid of ['driver-a','client','admin'])await assertFails(updateDoc(doc(db(uid),'orders','order-a'),{commissionTerms:{rate:0,baseAmount:5000,amount:0}}));
 });
 await test('configured phone assignment requires an atomic free-driver reservation',async()=>{
  const d=db('admin'),profile=await readDriver(),data={...await readOrder(),status:'accepted',clientUid:'',source:'dispatcher',assignedDriverId:'d-a',assignedDriverUid:'driver-a',...finance.reserveCommission(profile,5000)};
  await assertFails(setDoc(doc(d,'orders','phone'),data));
  const batch=writeBatch(d);batch.set(doc(d,'orders','phone'),data);batch.update(doc(d,'driverStates','driver-a'),{status:'busy',activeOrderId:'phone',lastSeen:serverTimestamp(),updatedAt:serverTimestamp()});await batch.commit();
  const duplicate=writeBatch(d);duplicate.set(doc(d,'orders','phone2'),data);duplicate.update(doc(d,'driverStates','driver-a'),{status:'busy',activeOrderId:'phone2'});await assertFails(duplicate.commit());
 });
 await test('saving percentage preserves newly charged balance and rejects stale balance edits',async()=>{
  const original={id:'d-a',...await readDriver()};
  const controls={name:{value:'Driver'},phone:{value:''},car:{value:''},color:{value:''},balance:{value:'-100'},status:{value:'active'},uid:{value:'driver-a'},button:{},message:{},vehicleControls:{read:()=>({serviceCategories:['sedan'],passengerSeats:4})},financeControls:{read:()=>({commissionRate:15,debtMode:'limited',debtLimit:1000})}};
  await updateDoc(doc(db('admin'),'drivers','d-a'),{balance:100});
  assert.ok((await run('saveDriver','admin',[original,controls])).success);assert.equal((await readDriver()).balance,100);assert.equal((await readDriver()).commissionRate,15);
  const refreshed={id:'d-a',...await readDriver()}; controls.balance.value='0'; controls.financeControls.read=()=>finance.financeSettings(refreshed);
  await updateDoc(doc(db('admin'),'drivers','d-a'),{balance:200});
  assert.ok(!(await run('saveDriver','admin',[refreshed,controls])).success);assert.equal((await readDriver()).balance,200);
 });
 await test('adding an existing person creates only a paused cargo card and retains identity and balance',async()=>{
  const before=await readDriver();assert.ok((await run('addExistingDriver','admin')).success);
  const after=await readDriver();assert.equal(after.authUid,before.authUid);assert.equal(after.balance,before.balance);assert.equal(after.car,before.car);assert.equal(after.cargoProfile.status,'paused');assert.equal(after.cargoProfile.payloadKg,0);
  assert.ok(!(await run('addExistingDriver','admin')).success);
 });
 const cargoProfile = {status:'active',car:'Газель',color:'Белый',plate:'TEST-30',bodyType:'Фургон',dimensions:'3 × 2 × 2',payloadKg:1500,commissionRate:5};
 async function cargoDriver(extra={}) {await updateDoc(doc(db('admin'),'drivers','d-a'),{cargoProfile,...extra});}
 async function cargoOrder(id='cargo-a') {await setDoc(doc(db('admin'),'orders',id),{...await readOrder(),serviceType:'cargo',source:'dispatcher',clientUid:'client',serviceDetails:{cargoDescription:'Коробки',movers:0}});}
 await test('passenger and cargo queries are isolated; a shared driver can query both',async()=>{
  await cargoOrder();const d=db('driver-a');
  await assertFails(getDoc(doc(d,'orders','cargo-a')));
  await assertFails(sdk.getDocs(sdk.query(sdk.collection(d,'orders'),sdk.where('status','==','searching'))));
  const list=services=>sdk.getDocs(sdk.query(sdk.collection(d,'orders'),sdk.where('status','==','searching'),sdk.where('serviceType','in',services)));
  assert.equal((await list(['taxi'])).size,1);
  await cargoDriver();assert.equal((await list(['taxi','cargo'])).size,2);
  await cargoDriver({passengerEnabled:false});assert.equal((await list(['cargo'])).size,1);
  await assertFails(list(['taxi']));await assertFails(getDoc(doc(d,'orders','order-a')));
 });
 await test('cargo-only driver uses truck and its 5% commission; completion settles shared balance',async()=>{
  await cargoDriver({passengerEnabled:false});await cargoOrder();
  assert.ok((await run('acceptOrder','driver-a',['cargo-a'])).success);
  const accepted=await readOrder('cargo-a');assert.equal(accepted.driverCar,'Газель · TEST-30');assert.equal(accepted.driverColor,'Белый');assert.equal(accepted.commissionTerms.rate,5);
  await updateDoc(doc(db('admin'),'drivers','d-a'),{cargoProfile:{...cargoProfile,status:'paused',commissionRate:90}});
  assert.ok((await run('advanceOrder','driver-a',['cargo-a','accepted','arrived'])).success);
  assert.ok((await run('advanceOrder','driver-a',['cargo-a','arrived','completed'])).success);
  assert.equal((await readDriver()).balance,150);assert.equal((await readOrder('cargo-a')).commissionRate,5);
 });
 await test('concurrent passenger and cargo acceptance locks the same driver state',async()=>{
  await cargoDriver();await cargoOrder();
  await Promise.all([run('acceptOrder','driver-a',['order-a']),run('acceptOrder','driver-a',['cargo-a'])]);
  const statuses=[(await readOrder()).status,(await readOrder('cargo-a')).status];assert.equal(statuses.filter(s=>s==='accepted').length,1);assert.equal(statuses.filter(s=>s==='searching').length,1);
 });
 await test('cargo vehicle and rate cannot be replaced with passenger values',async()=>{
  await cargoDriver();await cargoOrder();const d=db('driver-a');
  for(const bad of [{driverCar:''},{commissionTerms:{rate:20,baseAmount:5000,amount:1000}}]) {
   const batch=writeBatch(d);batch.update(doc(d,'orders','cargo-a'),{status:'accepted',assignedDriverUid:'driver-a',assignedDriverId:'d-a',driverName:'Driver',driverPhone:'',driverCar:'Газель · TEST-30',driverColor:'Белый',acceptedAt:serverTimestamp(),updatedAt:serverTimestamp(),commissionTerms:{rate:5,baseAmount:5000,amount:250},...bad});
   batch.update(doc(d,'driverStates','driver-a'),{status:'busy',activeOrderId:'cargo-a',lastSeen:serverTimestamp(),updatedAt:serverTimestamp()});await assertFails(batch.commit());
  }
  assert.ok((await run('acceptOrder','driver-a',['cargo-a'])).success);
  await assertFails(updateDoc(doc(d,'orders','cargo-a'),{driverCar:'Другое авто'}));
  await assertFails(updateDoc(doc(db('admin'),'orders','cargo-a'),{serviceType:'taxi'}));
 });
 await test('dispatcher assigns truck; pausing cargo keeps passenger direction available',async()=>{
  await cargoDriver();await cargoOrder();assert.ok((await run('assignOrderManually','admin',['cargo-a','d-a'])).success);assert.equal((await readOrder('cargo-a')).driverCar,'Газель · TEST-30');
  await run('cancelOnlineOrder','admin',[{id:'cargo-a',...await readOrder('cargo-a')}]);
  await updateDoc(doc(db('admin'),'drivers','d-a'),{cargoProfile:{...cargoProfile,status:'blocked'}});
  await cargoOrder('cargo-b');await assertFails(getDoc(doc(db('driver-a'),'orders','cargo-b')));assert.ok((await run('acceptOrder','driver-a',['order-a'])).success);
 });
 await test('driver cannot self-register another direction or change cargo commission',async()=>{
  await assertFails(updateDoc(doc(db('driver-a'),'drivers','d-a'),{cargoProfile}));
  await cargoDriver();await assertFails(updateDoc(doc(db('driver-a'),'drivers','d-a'),{'cargoProfile.commissionRate':0}));
  await assertFails(updateDoc(doc(db('admin'),'drivers','d-a'),{cargoProfile:{...cargoProfile,payloadKg:0}}));
  await assertFails(updateDoc(doc(db('admin'),'drivers','d-a'),{cargoProfile:{...cargoProfile,commissionRate:101}}));
 });
 await test('saving cargo commission preserves passenger car, rate, shared balance and account',async()=>{
  await cargoDriver();const original={id:'d-a',...await readDriver()};
  const controls={direction:'cargo',serviceStatus:{value:'active'},name:{value:'Driver'},phone:{value:''},car:{value:'Газель'},color:{value:'Белый'},balance:{value:'-100'},status:{value:'active'},uid:{value:'driver-a'},button:{},message:{},vehicleControls:{read:base=>({...cargoProfile,...base})},financeControls:{read:()=>({commissionRate:7,debtMode:'limited',debtLimit:1000})}};
  await updateDoc(doc(db('admin'),'drivers','d-a'),{balance:50});assert.ok((await run('saveDriver','admin',[original,controls])).success);
  const updated=await readDriver();assert.equal(updated.balance,50);assert.equal(updated.commissionRate,20);assert.equal(updated.car,'');assert.equal(updated.cargoProfile.commissionRate,7);assert.equal(updated.authUid,'driver-a');
  const history=await sdk.getDocs(sdk.collection(db('admin'),'driverServiceHistory'));assert.equal(history.size,1);assert.equal(history.docs[0].data().next.commissionRate,7);
 });
 await test('new cargo registration creates one cargo-only person and cannot overwrite ID or Google link',async()=>{
  const fields=Object.fromEntries(Object.entries({newDriverNumber:'30',newDriverName:'New cargo',newDriverPhone:'',newDriverCar:'Газель',newDriverColor:'Белый',newDriverBalance:'-100',newDriverUid:'cargo-new',newDriverStatus:'active'}).map(([key,value])=>[key,{value}]));
  const form={...fields,addDriverButton:{},addDriverMessage:{},addDriverForm:{reset(){}}};
  const controls={document:{getElementById:()=>({value:'cargo'})},elements:form,renderDrivers(){},updateNewDriverDirection(){},newDriverVehicleControls:{reset(){}},newDriverFinanceControls:{read:()=>({commissionRate:5,debtMode:'none',debtLimit:0}),reset(){}},newDriverCargoControls:{read:base=>({...cargoProfile,...base}),reset(){}}};
  assert.ok((await run('addDriver','admin',[{preventDefault(){}}],controls)).success);
  const driver=(await getDoc(doc(db('admin'),'drivers','30'))).data();assert.equal(driver.passengerEnabled,false);assert.equal(driver.car,'');assert.equal(driver.cargoProfile.car,'Газель');assert.equal(driver.authUid,'cargo-new');
  assert.ok(!(await run('addDriver','admin',[{preventDefault(){}}],controls)).success);
  fields.newDriverNumber.value='31';assert.ok(!(await run('addDriver','admin',[{preventDefault(){}}],controls)).success);assert.equal((await getDoc(doc(db('admin'),'drivers','31'))).exists(),false);
 });
 await test('legacy dual driver cannot bypass shared lock through unreserved dispatcher assignment',async()=>{
  await seed({},-100);await cargoDriver();await cargoOrder();assert.ok((await run('acceptOrder','driver-a',['cargo-a'])).success);
  await assertFails(updateDoc(doc(db('admin'),'orders','order-a'),{status:'accepted',assignedDriverUid:'driver-a',assignedDriverId:'d-a',driverName:'Driver',driverPhone:'',driverCar:'',driverColor:''}));
 });
 console.log(`ALL ${passed} DRIVER FINANCE CHECKS PASSED`);
} finally {await env.cleanup();}
