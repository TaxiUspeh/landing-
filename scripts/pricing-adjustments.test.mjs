import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { selectPriceAdjustment, adjustmentText, deliveryQuote } from '../pricing-adjustments.js';
import { createDeliveryPricing } from '../delivery-pricing.js';
import { normalizeCity } from '../booking-core.js';
import { reserveCommission, orderCommission } from '../driver-finance.js';

const factors = { NIGHT:1.3, HIGH_DEMAND:1.2, SCARCE_CARS:1.3, SNOW:1.5, EXTREME_COLD:1.6, HOLIDAY:1.25 };
const select = (input = {}, overrides = {}) => selectPriceAdjustment({ hour:12, modeledCars:5, ...input }, { ...factors, ...overrides });

test('all combinations choose exactly one greatest factor, including weather, holiday and model', () => {
  for (const hour of [0,5,6,7,9,10,12,17,19,20,23]) for (const modeledCars of [0,1,3,4,6])
  for (const temperature of [-30,-25,-24,20]) for (const weathercode of [0,73,75,85,86]) for (const holiday of [false,true]) {
    const expected = Math.max(1, hour < 6 ? 1.3 : 1, modeledCars < 4 ? 1.3 : 1,
      ((hour>=7&&hour<10)||(hour>=17&&hour<20)) ? 1.2 : 1,
      temperature <= -25 ? 1.6 : 1, weathercode ? 1.5 : 1, holiday ? 1.25 : 1);
    const winner=select({hour,modeledCars,weather:{temperature,weathercode},holiday});
    assert.equal(winner.multiplier,expected);
    assert.equal(deliveryQuote(1200,winner).priceAmount,Math.ceil(1200*expected/50)*50);
  }
  assert.equal(select({weather:{temperature:-30},holiday:true},{HOLIDAY:1.8}).code,'holiday','No early return for severe weather');
});
test('model scarcity is labeled and a zero-car night cannot pretend it is snow', () => {
  assert.equal(select({hour:1,modeledCars:0}).multiplier,1.3);
  assert.equal(select({hour:1,modeledCars:0}).code,'modeled_scarcity');
  assert.match(adjustmentText(select({modeledCars:3})),/Мало машин \(модель\)/);
  assert.equal(select().code,'standard');
  assert.equal(select({hour:8}).code,'rush_hour');
  assert.equal(select({hour:1}).code,'night');
  for (const modeledCars of [undefined,NaN,-1,2.5]) assert.equal(select({modeledCars}).code,'standard');
});
test('single delivery amount uses existing 50-tenge rounding and fits the deployed Firestore price field', () => {
  for (const input of [{},{modeledCars:2},{hour:8},{hour:1},{holiday:true},{weather:{weathercode:75}},{weather:{temperature:-30}}]) {
    const quote=deliveryQuote(1200,select(input));
    assert.ok(quote.priceText.length<=80);
    assert.ok(Buffer.byteLength(quote.priceText)<=80);
    assert.ok(!/от|~|–/.test(quote.amountText));
  }
  assert.equal(deliveryQuote(1200,select({modeledCars:2})).priceAmount,1600);
  for (const base of [null,0,-100,NaN,Infinity,10000001]) assert.equal(deliveryQuote(base,select()),null);
  assert.equal(deliveryQuote(1200,null),null);
});

const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
const clients=await readFile(new URL('../client-orders.js',import.meta.url),'utf8');
const slice=(start,end)=>html.slice(html.indexOf(start),html.indexOf(end,html.indexOf(start)));
const config=html.match(/const CONFIG = ([\s\S]*?);/)[0];
const rates=slice('        const INTERCITY_RATES =','        function selectedTaxiCity(');
const pricing=slice('        const deliveryPricing = createDeliveryPricing(','        window.updateCargoPrice = function()');
const submit=clients.slice(clients.indexOf('function containsRestrictedDeliveryItems'),clients.indexOf('async function cancelOnlineOrder()'));
function harness() {
  const state={writes:[],messages:[],distance:13152.2,from:'Магазин Центральный, 2',auth:async()=>({uid:'client'})};
  const nodes={deliveryCitySelect:{value:''},deliveryPriceEstimate:{textContent:''},deliveryWaitTime:{},
    deliveryItems:{value:'Хлеб, молоко, стоимость товаров 9999'},deliveryStore:{value:'Магазин'},deliveryAddress:{value:'Мира, 5'}};
  const window={carMarkers:[{lat:50.1,lng:82.5}],bookingScreen:{isPreview:()=>false,modeledCarCity:async()=> 'Белоусовка',deliveryData:()=>({stops:[],wishes:''}),deliveryRoutePoints:()=>[{address:state.from,city:'Белоусовка'},{address:nodes.deliveryAddress.value,city:nodes.deliveryCitySelect.value||'Белоусовка'}]}};
  const ctx=vm.createContext({window,console,normalizeCity,deliveryQuote,
    createDeliveryPricing: options => createDeliveryPricing({...options,wait:async()=>{}}),
    getCoordinates: async(address,city)=>city==='Неизвестное село'?null:{lat:50.1,lon:82.5},getRouteDistance:async()=>state.distance,
    document:{getElementById:id=>nodes[id]},ONLINE_ORDERS_ENABLED:true,actionInProgress:false,activeOrderView:'',resumeExistingOrder:()=>false,
    setStatus:message=>state.messages.push(message),combineAddress:()=>nodes.deliveryAddress.value,
    elements:{deliveryCustomerName:{value:'Тест'},deliveryCustomerPhone:{value:'+77000000000'}},normalizePhone:x=>x,validPhone:()=>true,
    prepareClientOrderSound:()=>{},setActionBusy:()=>{},ensureSignedIn:()=>state.auth(),db:{},doc:(...a)=>({id:a.at(-1)}),collection:()=> 'orders',createOrderNumber:()=> 'TU-TEST',
    writeBatch:()=>({set:(ref,data)=>state.writes.push(data),commit:async()=>{}}),serverTimestamp:()=> 'now',storeValue:()=>{},startOrderWatch:()=>{},CUSTOMER_NAME_STORAGE_KEY:'name',CUSTOMER_PHONE_STORAGE_KEY:'phone'});
  vm.runInContext(config+rates+'let pricingAdjustment = null;'+pricing+submit,ctx);
  return {state,nodes,window,update:()=>window.updateDeliveryPrice(),quote:()=>window.getDeliveryFareForOrder(),status:()=>window.getDeliveryPriceState(),
    adjust:adjustment=>{ctx.nextAdjustment=adjustment;vm.runInContext('pricingAdjustment = nextAdjustment',ctx);},submit:()=>vm.runInContext('createOnlineDeliveryOrder()',ctx)};
}
test('actual delivery handler blocks pending/unknown tariffs and does not parse prices from text',async()=>{
  const h=harness();h.update();assert.equal(h.status(),'pending');await h.submit();assert.equal(h.state.writes.length,0);
  h.adjust(select());h.update();assert.equal(h.quote().priceAmount,1200);
  h.nodes.deliveryPriceEstimate.textContent='999999 ₸';await h.submit();assert.equal(h.state.writes[0].priceAmount,1200);
  h.nodes.deliveryCitySelect.value='Неизвестное село';assert.equal(h.quote(),null);await h.update();assert.equal(h.status(),'unavailable');await h.submit();assert.equal(h.state.writes.length,2);
});
test('intercity delivery stores the route fee before an authentication delay',async()=>{
  const h=harness();h.nodes.deliveryCitySelect.value='Прогресс';h.adjust(select());await h.update();
  const displayed=h.quote();assert.equal(displayed.priceAmount,3250);assert.match(displayed.priceText,/3250 ₸/);
  let finishAuth;h.state.auth=()=>new Promise(resolve=>{finishAuth=resolve;});
  const pending=h.submit();assert.equal(h.state.writes.length,0);
  h.adjust(select({weather:{temperature:-30}}));await h.update();assert.equal(h.quote().priceAmount,5200);
  finishAuth({uid:'client'});await pending;
  assert.equal(h.state.writes[0].priceAmount,3250);assert.equal(h.state.writes[0].priceText,displayed.priceText);
});
test('delivery commission uses saved final fee and individually configured rate including zero, excluding goods',async()=>{
  const h=harness();h.adjust(select({modeledCars:2,holiday:true}));h.update();await h.submit();
  const order=h.state.writes[0];assert.equal(order.priceAmount,1600);assert.match(order.priceText,/модель/);
  for (const rate of [0,5,20,27,100]) {
    const driver={commissionRate:rate,balance:0,debtMode:'unlimited',debtLimit:0};
    const accepted={...order,...reserveCommission(driver,order.priceAmount)};
    driver.commissionRate=42;
    assert.equal(orderCommission(accepted).rate,rate);assert.equal(orderCommission(accepted).amount,1600*rate/100);
  }
});

test('an order cannot be placed using a car-based preview without a pickup address',async()=>{
  const h=harness();h.state.from='';h.adjust(select());await h.update();await h.submit();
  assert.equal(h.quote(),null);assert.equal(h.state.writes.length,0);
});
test('any-store delivery saves the displayed car-based fee before auth and excludes goods from commission',async()=>{
  const h=harness();h.state.from='магазин';h.nodes.deliveryStore.value='Любой магазин — выбирает водитель';
  h.nodes.deliveryCitySelect.value='Прогресс';h.state.distance=10000;h.adjust(select({modeledCars:2}));await h.update();
  const displayed=h.quote();assert.equal(displayed.anyStore,true);assert.equal(displayed.priceAmount,3400);
  let finishAuth;h.state.auth=()=>new Promise(resolve=>{finishAuth=resolve;});const pending=h.submit();
  h.window.carMarkers[0].lng=83;h.adjust(select({weather:{temperature:-30}}));await h.update();assert.equal(h.quote().priceAmount,4200);
  finishAuth({uid:'client'});await pending;
  const order=h.state.writes[0];assert.equal(order.priceAmount,3400);assert.equal(order.priceText,displayed.priceText);
  assert.equal(order.serviceDetails.store,'Любой магазин — выбирает водитель');assert.match(order.fromAddress,/Любой магазин/);
  const accepted={...order,...reserveCommission({commissionRate:15,balance:0,debtMode:'unlimited',debtLimit:0},order.priceAmount)};
  assert.equal(orderCommission(accepted).amount,510);
});
