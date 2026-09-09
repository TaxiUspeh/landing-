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
async function run(name, uid, args=[]) {
 const database=db(uid),profile=(await getDoc(doc(db('admin'),'drivers','d-a'))).data();
 const messages=[];
 const context={...sdk,...finance,...auction,driverCanServeOrder,validVehicleProfile,ensureUidAvailable:async()=>{},parseBalance:value=>Number(value),validateUid:()=>true,db:database,currentUser:{uid},currentDriver:profile,currentDriverId:'d-a',currentCanTakeOrders:finance.hasOrderFunds(profile),currentBaseEligible:finance.hasOrderFunds(profile),orderActionInProgress:false,dispatcherCompletionInProgress:false,manualOrderAssignmentInProgress:false,
 ACTIVE_ORDER_STATUSES:active,CANCELLABLE_ORDER_STATUSES:new Set([...active,'searching','bidding']),REQUEUEABLE_ORDER_STATUSES:new Set(['accepted','en_route','arrived']),REQUEUE_REASONS:[['car_issue','Неисправность автомобиля']],AVAILABLE_DRIVER_STATE:{status:'available',activeOrderId:''},
 window:{confirm:()=>true},console:{warn:()=>{},error:()=>{}},elements:{onlineOrdersMessage:{}},
 renderOnlineOrders:()=>{},showOrdersMessage:(message,success)=>messages.push({message,success}),setMessage:(el,message,success)=>messages.push({message,success}),formatMoney:value=>String(value)+' ₸',normalizeUid:value=>value,
 normalizedDriverState:snapshot=>({...snapshot.data(),exists:snapshot.exists()}),findManualAssignmentDriver:()=>({...profile,id:'d-a'}),driverAvailabilityInfo:()=>({key:'available'}),args};
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
try {
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
 await test('exact limit hides open orders; recorded top-up restores access',async()=>{
  await updateDoc(doc(db('admin'),'drivers','d-a'),{balance:0});await run('acceptOrder','driver-a',['order-a']);await arriveComplete();
  await order('order-b');assert.equal((await readDriver()).balance,1000);
  await assertFails(sdk.getDocs(sdk.query(sdk.collection(db('driver-a'),'orders'),sdk.where('status','==','searching'))));
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
 console.log(`ALL ${passed} DRIVER FINANCE CHECKS PASSED`);
} finally {await env.cleanup();}
