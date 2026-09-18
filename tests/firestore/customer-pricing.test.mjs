import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import * as sdk from 'firebase/firestore';
import { offerFields, priceSettings, increaseOrderPrice, retryPriceConflict } from '../../customer-pricing.js';
import { reserveCommission } from '../../driver-finance.js';
const {doc,setDoc,getDoc,getDocs,collection,query,where,runTransaction,serverTimestamp,updateDoc}=sdk;
const env=await initializeTestEnvironment({projectId:'demo-taxi-rules-check',firestore:{host:'127.0.0.1',port:8088,rules:await readFile('../../firestore.rules','utf8')}});
const db=uid=>uid?env.authenticatedContext(uid).firestore():env.unauthenticatedContext().firestore();
const client=db('client'),driver=db('driver'),admin=db('admin');
const stamp=()=>({createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
const base=(fields={})=>({orderNumber:'TU-TEST',serviceType:'taxi',source:'online',clientUid:'client',fromAddress:'Секисовка А',toAddress:'Глубокое Б',stops:[],wishes:'',scheduledFor:'',direction:'',status:'searching',...stamp(),...offerFields(4232,null,'taxi',priceSettings(),'distance'),priceUpdatedAt:serverTimestamp(),routeDistanceMeters:18400,...fields});
async function make(id='order',fields={}) {await setDoc(doc(client,'orders',id),base(fields));}
async function raise(amount=5000,operationId='increase-1',database=client,uid='client') {return increaseOrderPrice(database,sdk,{orderId:'order',uid,amount,operationId});}
async function accept() {return retryPriceConflict(()=>runTransaction(driver,async t=>{const ref=doc(driver,'orders','order'),snap=await t.get(ref);const d=await t.get(doc(driver,'drivers','d'));const state=await t.get(doc(driver,'driverStates','driver'));assert.equal(snap.data().status,'searching');assert.equal(state.data().status,'available');t.update(ref,{status:'accepted',assignedDriverUid:'driver',assignedDriverId:'d',driverName:'Test',driverCar:'',driverPhone:'',driverColor:'',acceptedAt:serverTimestamp(),updatedAt:serverTimestamp(),...reserveCommission(d.data(),snap.data().priceAmount)});t.update(doc(driver,'driverStates','driver'),{status:'busy',activeOrderId:'order',lastSeen:serverTimestamp(),updatedAt:serverTimestamp()});}));}
async function seed(){await env.clearFirestore();await env.withSecurityRulesDisabled(async ctx=>{const d=ctx.firestore();await setDoc(doc(d,'admins','admin'),{active:true});for(const [uid,id,status] of [['driver','d','active'],['blocked','b','blocked']]){await setDoc(doc(d,'drivers',id),{status,name:'Test',authUid:uid,balance:0,commissionRate:15,debtMode:'unlimited',debtLimit:0});await setDoc(doc(d,'driverAccounts',uid),{active:true,driverId:id});await setDoc(doc(d,'driverStates',uid),{driverId:id,status:'available',activeOrderId:'',lastSeen:serverTimestamp(),updatedAt:serverTimestamp()});}});}
let passed=0;async function test(name,fn){await seed();await fn();passed++;console.log('PASS:',name);}
try {
 await test('standard, offer and fallback creation; invalid money and inconsistent metadata rejected',async()=>{
  await make();await make('offer',{...offerFields(4232,5000,'taxi',priceSettings(),'distance')});
  await make('fallback',{...offerFields(null,1200,'delivery',priceSettings()),serviceType:'delivery',serviceDetails:{store:'Любой магазин',items:'Хлеб'},routeDistanceMeters:null});
  await assertFails(make('zero',{priceAmount:0}));await assertFails(make('tamper',{calculatedPrice:9000}));await assertFails(make('negative',{customerOfferPrice:-1}));
  await assertFails(make('bad-category',{vehicleCategory:'minivan',passengerCount:5,basePriceMin:800,basePriceMax:800}));
 });
 await test('raise preserves original, audit is atomic, same operation retry does not raise twice',async()=>{
  await make();await raise();await raise();let o=(await getDoc(doc(client,'orders','order'))).data();assert.equal(o.priceAmount,5000);assert.equal(o.calculatedPrice,4232);assert.equal(o.priceRevision,1);
  assert.equal((await getDocs(collection(client,'orders','order','priceChanges'))).size,1);
  await assertFails(updateDoc(doc(client,'orders','order'),{priceAmount:5500,priceText:'5500 ₸'}));
  await assertFails(updateDoc(doc(client,'orders','order','priceChanges','increase-1'),{newPrice:100}));
  await assert.rejects(raise(4500,'lower'));await assert.rejects(raise(5500,'hacker',db('other'),'other'));
 });
 await test('driver acceptance freezes current offer and configurable 15% commission',async()=>{
  await make();await raise();await accept();const o=(await getDoc(doc(client,'orders','order'))).data();assert.deepEqual(o.commissionTerms,{baseAmount:5000,rate:15,amount:750});
  await assert.rejects(raise(6000,'late'));await raise(5000,'increase-1');assert.equal((await getDoc(doc(client,'orders','order'))).data().priceAmount,5000);
 });
 await test('race with acceptance commits either old price or new price, never mismatched commission',async()=>{
  await make();const race=await Promise.allSettled([raise(),accept()]);assert.equal(race[1].status,"fulfilled");const o=(await getDoc(doc(client,'orders','order'))).data();assert.equal(o.status,'accepted');assert.ok([4232,5000].includes(o.priceAmount));assert.equal(o.commissionTerms.baseAmount,o.priceAmount);assert.equal(o.commissionTerms.amount,Math.round(o.priceAmount*15)/100);
 });
 await test('concurrent raises cannot lower the current price',async()=>{await make();await Promise.allSettled([raise(5000,'a'),raise(6000,'b')]);assert.equal((await getDoc(doc(client,'orders','order'))).data().priceAmount,6000);});
 await test('all active registered drivers can read, including busy/no-funds; blocked and anonymous cannot',async()=>{
  await make();await env.withSecurityRulesDisabled(ctx=>updateDoc(doc(ctx.firestore(),'drivers','d'),{balance:100000,debtMode:'none'}));await updateDoc(doc(admin,'driverStates','driver'),{status:'busy',activeOrderId:'another'});
  const list=d=>getDocs(query(collection(d,'orders'),where('status','==','searching')));await assertSucceeds(list(driver));await assertFails(list(db('blocked')));await assertFails(list(db('stranger')));await assertFails(list(db(null)));
 });
 await test('public settings controlled only by dispatcher and enforced on raises',async()=>{
  await assertSucceeds(getDoc(doc(db(null),'settings','customerPricing')));await assertFails(setDoc(doc(client,'settings','customerPricing'),priceSettings()));
  await setDoc(doc(admin,'settings','customerPricing'),priceSettings({minimumIncrease:100,maximumPrice:5000}));await make();await assert.rejects(raise(4250));await assert.rejects(raise(5001));await raise(5000);
 });
 await test('own absent id is readable for idempotent transaction but cannot disclose other absent/existing orders',async()=>{
  await assertSucceeds(getDoc(doc(client,'orders','client_uuid')));await assertFails(getDoc(doc(db('other'),'orders','client_uuid')));
  let writes=0;async function submit(){await runTransaction(client,async t=>{const ref=doc(client,'orders','client_uuid');if((await t.get(ref)).exists())return;t.set(ref,base());writes++;});}
  await submit();await submit();assert.equal(writes,1);
 });
 await test('actual submission helper reuses committed id after lost reply, including contact; rejected contact creates nothing',async()=>{
  const source=await readFile('../../client-orders.js','utf8');
  const helper=source.slice(source.indexOf('async function commitPendingSubmission(record)'),source.indexOf('const priceControls ='));
  const saved=new Map();
  const commit=Function('db','auth','doc','runTransaction','serverTimestamp','storeValue','ACTIVE_ORDER_STORAGE_KEY','PENDING_SUBMISSION_KEY',helper+';return commitPendingSubmission;')(client,{currentUser:{uid:'client'}},doc,runTransaction,serverTimestamp,(k,v)=>saved.set(k,v),'active','pending');
  const {createdAt,updatedAt,priceUpdatedAt,...body}=base();
  const record={id:'client_attempt',uid:'client',writes:[{contact:false,body},{contact:true,body:{clientUid:'client',customerName:'Тест',customerPhone:'+77000000000',passengerPhone:''}}]};
  await commit(record);await updateDoc(doc(admin,'orders',record.id),{wishes:'Server already processed this order'});await commit(record);
  assert.equal((await getDoc(doc(client,'orders',record.id))).data().wishes,'Server already processed this order');
  assert.equal((await getDoc(doc(client,'orderContacts',record.id))).data().customerName,'Тест');assert.equal(saved.get('active'),record.id);assert.equal(saved.get('pending'),'');
  const bad={...record,id:'client_bad',writes:[record.writes[0],{contact:true,body:{...record.writes[1].body,clientUid:'other'}}]};
  await assertFails(commit(bad));assert.equal((await getDoc(doc(client,'orders',bad.id))).exists(),false);
 });
 console.log(`${passed} customer price rule scenarios passed`);
} finally {await env.cleanup();}
