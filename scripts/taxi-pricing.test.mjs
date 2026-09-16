import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { normalizeCity } from '../booking-core.js';
import { publishedRouteFare, distanceFare, formatTaxiFare } from '../taxi-pricing.js';
import { calculateCategoryFare } from '../vehicle-categories.js';
import { reserveCommission, orderCommission } from '../driver-finance.js';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const slice = (a, b) => html.slice(html.indexOf(a), html.indexOf(b, html.indexOf(a)));
const source = slice('        const CONFIG =', '        window.initLuckyMode')
  .match(/const CONFIG = ([\s\S]*?);/)[0];
const ratesSource = slice('        const INTERCITY_RATES =', '        function intercityRateForCity');
const pricingSource = slice('        let taxiFareSnapshot = null;', '        const debouncedOSRM = debounce(')
  + slice('        window.updateTaxiPrice = function()', '        window.updateDeliveryPrice = function()');
const clientSource = await readFile(new URL('../client-orders.js', import.meta.url), 'utf8');
const submitSource = clientSource.slice(clientSource.indexOf('async function createOnlineOrder()'), clientSource.indexOf('function containsRestrictedDeliveryItems'));

function harness(from = 'Белоусовка', to = 'Белоусовка') {
  const state = { points: [{address:'Кутузова',city:from},{address:'Панфилова, 8',city:to}], distance:1000, category:'sedan', textContent:'', writes:[], messages:[], routes:0 };
  const nodes = { taxiPriceEstimate:state, taxiHouse:{value:'12'}, taxiTo:{value:'Панфилова, 8'}, taxiFromCitySelect:{value:normalizeCity(from)}, taxiCitySelect:{value:normalizeCity(to)}, taxiDateTime:{value:''}, taxiWishes:{value:''} };
  const window = { bookingScreen:{vehicleRequest:()=>({vehicleCategory:state.category,passengerCount:1}),isPreview:()=>false} };
  const ctx = vm.createContext({window,console,normalizeCity,publishedRouteFare,distanceFare,formatTaxiFare,calculateCategoryFare,
    document:{getElementById:id=>nodes[id]}, getTaxiRatePoints:()=>state.points.map(p=>({...p,city:normalizeCity(p.city)})),
    getTaxiRoutePoints:()=>state.points.map(p=>({...p,city:normalizeCity(p.city)})),
    setTaxiRouteHint:()=>{},debouncedOSRM:()=>{},countFilledAddresses:()=>state.points.length,
    getCoordinates:async()=>({lat:50,lon:82}),getRouteDistance:async()=>{state.routes++;return state.distance;},
    ONLINE_ORDERS_ENABLED:true,actionInProgress:false,activeOrderView:'',resumeExistingOrder:()=>false,
    setStatus:message=>state.messages.push(message),combineAddress:()=>state.points[0].address,
    elements:{customerName:{value:''},customerPhone:{value:'+77000000000'}}, normalizePhone:x=>x||'',validPhone:()=>true,
    prepareClientOrderSound:()=>{},setActionBusy:()=>{},ensureSignedIn:async()=>({uid:'customer'}),db:{},
    doc:(...args)=>({id:args.at(-1)}),collection:()=> 'orders',createOrderNumber:()=> 'TU-TEST',collectStops:()=>[],
    writeBatch:()=>({set:(ref,data)=>state.writes.push(data),commit:async()=>{}}),serverTimestamp:()=> 'now',
    storeValue:()=>{},startOrderWatch:()=>{},CUSTOMER_NAME_STORAGE_KEY:'name',CUSTOMER_PHONE_STORAGE_KEY:'phone'
  });
  vm.runInContext(source + ratesSource + `
    let taxiRouteCalculationId = 0, priceMultiplier = 1.3, isLuckyDiscount = false;
    function calculateTaxiDatabaseFallback() { return publishedRouteFare(getTaxiRatePoints(), INTERCITY_RATES); }
  ` + pricingSource + submitSource, ctx);
  return {state,nodes,update:()=>window.updateTaxiPrice(),route:()=>vm.runInContext('calculateTaxiPriceOSRM()',ctx),
    quote:()=>window.getTaxiFareForOrder(),status:()=>window.getTaxiPriceState(),submit:()=>vm.runInContext('createOnlineOrder()',ctx)};
}

test('1040 route quote survives submit sync and is saved verbatim, never as 1040–1300', async()=>{
  const h=harness();h.update();assert.equal(h.status(),'pending');await h.route();
  assert.equal(h.quote().priceMax,1040);const before=h.quote();h.update();
  assert.deepEqual(h.quote(),before);await h.submit();
  assert.equal(h.state.writes[0].priceAmount,1040);assert.equal(h.state.writes[0].priceText,before.priceText);
});
test('published Belokamenka fare wins in both directions even when OSRM would return 2400',async()=>{
  for(const cities of [['Belokamenka','Белоусовка'],['Белоусовка','Белокаменка']]){
    const h=harness(...cities);h.state.distance=8000;h.update();await h.route();h.update();await h.submit();
    assert.equal(h.state.routes,0);assert.equal(h.state.writes[0].priceAmount,3500);assert.equal(h.state.writes[0].priceText,'3500 ₸');
  }
});
test('pending and unavailable routes cannot create zero-price orders',async()=>{
  const h=harness('Неизвестный посёлок');h.state.distance=null;h.update();await h.submit();
  assert.equal(h.state.writes.length,0);await h.route();assert.equal(h.status(),'unavailable');await h.submit();
  assert.equal(h.state.writes.length,0);assert.match(h.state.messages.at(-1),/диспетчеру/);
});
test('unknown intercity route uses 230 per km and city fallback is displayed before submit',async()=>{
  const h=harness('Неизвестный посёлок');h.state.distance=10000;h.update();await h.route();
  assert.equal(h.quote().priceMax,3000);
  const local=harness();local.state.distance=null;local.update();await local.route();
  assert.equal(local.quote().priceMin,1040);assert.equal(local.quote().priceMax,1300);
  const text=local.state.textContent;local.update();await local.submit();assert.equal(local.state.writes[0].priceText,text);
});
test('changing a house invalidates the old quote; non-price sync does not',async()=>{
  const h=harness();h.update();await h.route();h.nodes.taxiHouse.value='18';assert.equal(h.quote(),null);
  h.update();assert.equal(h.status(),'pending');await h.route();h.nodes.taxiWishes.value='Позвоните';h.update();assert.ok(h.quote());
});
test('tariff legs cannot omit an unknown town or invent a detour via Belousovka',()=>{
  const rates=[{name:'Белокаменка',min:3500,max:3500},{name:'Глубокое',min:2000,max:2500}];
  const points=(...cities)=>cities.map(city=>({city}));
  assert.equal(publishedRouteFare(points('Белокаменка','Глубокое'),rates),null);
  assert.equal(publishedRouteFare(points('Белокаменка','Белоусовка','Неизвестный'),rates),null);
  assert.equal(publishedRouteFare(points('Белокаменка','Белокаменка'),rates),null);
  assert.equal(publishedRouteFare(points('Белокаменка','Белоусовка','Глубокое'),rates).max,6000);
});
test('configured percentages including 0% apply to the stored price and remain frozen',()=>{
  for(const rate of [0,5,15,27,100]){
    const driver={commissionRate:rate,balance:0,debtMode:'unlimited',debtLimit:0};
    const order={priceAmount:1040,...reserveCommission(driver,1040)};driver.commissionRate=42;
    assert.equal(orderCommission(order).rate,rate);assert.equal(orderCommission(order).amount,Math.round(1040*rate)/100);
    assert.throws(()=>reserveCommission(driver,0),/диспетчер/);
  }
});
