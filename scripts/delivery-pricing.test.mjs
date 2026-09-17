import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeliveryPricing, deliveryRouteQuote, randomMapCar, deliveryPickupMode } from '../delivery-pricing.js';

const tariff={BASE_PRICE:1200,BASE_DISTANCE_KM:3,PRICE_PER_KM:200};
const standard={code:'standard',label:'Без надбавки',multiplier:1};
const scarcity={code:'modeled_scarcity',label:'Мало машин (модель)',multiplier:1.3};
const points=(...cities)=>cities.map((city,index)=>({address:`Улица ${index+1}`,city}));
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function harness(cities=['Белоусовка','Прогресс']) {
  const state={points:points(...cities),adjustment:standard,cars:[{lat:50.1,lon:82.5}],city:'Белоусовка',meters:10000,locates:[],routes:[],changes:[],randomCalls:0};
  const pricing=createDeliveryPricing({tariff,readInput:()=>state,readCars:()=>state.cars,locateCarCity:async()=>state.city,random:()=>{state.randomCalls++;return 0;},
    locate:async(address,city)=>{state.locates.push({address,city});return {lat:50.14,lon:82.53};},
    routeDistance:async coordinates=>{state.routes.push(coordinates);return typeof state.meters==='function'?state.meters():state.meters;},
    onChange:change=>state.changes.push(change),wait:async()=>{}});
  return {state,...pricing};
}
test('1200 within any one settlement; aliases and return via another settlement are classified correctly',()=>{
  for (const city of ['Белоусовка','Секисовка','Малая Убинка','Черногорка','Прогресс']) {
    const quote=deliveryRouteQuote(points(city,city),null,tariff,standard);
    assert.equal(quote.priceAmount,1200);assert.equal(quote.local,true);
  }
  assert.equal(deliveryRouteQuote(points('Belokamenka','Белокаменка'),null,tariff,standard).priceAmount,1200);
  assert.equal(deliveryRouteQuote(points('Progress','Прогресс'),null,tariff,standard).priceAmount,1200);
  assert.equal(deliveryRouteQuote(points('Малоубинка','Малая Убинка'),null,tariff,standard).priceAmount,1200);
  const loop=deliveryRouteQuote(points('Секисовка','Белоусовка','Секисовка'),20000,tariff,standard);
  assert.equal(loop.local,false);assert.equal(loop.priceAmount,4600);
});
test('intercity uses total one-way road distance, includes 3 km once and rounds final fee only',()=>{
  const route=points('Белоусовка','Прогресс');
  for (const [meters,expected] of [[2000,1200],[3000,1200],[3100,1250],[9500,2500],[9535.8,2550],[10000,2600],[13152.2,3250]]) {
    assert.equal(deliveryRouteQuote(route,meters,tariff,standard).priceAmount,expected);
    assert.equal(deliveryRouteQuote([...route].reverse(),meters,tariff,standard).priceAmount,expected);
  }
  assert.equal(deliveryRouteQuote(route,10000,tariff,scarcity).priceAmount,3400);
  // 1210 * 1.3 -> 1573 -> 1600, not 1250 * 1.3 -> 1650.
  assert.equal(deliveryRouteQuote(route,3050,tariff,scarcity).priceAmount,1600);
  for (const invalid of [null,0,-1,NaN,Infinity]) assert.equal(deliveryRouteQuote(route,invalid,tariff,standard),null);
});
test('all delivery stops go to the road router, and coordinates picked on a map are preserved',async()=>{
  const h=harness(['Белоусовка','Белокаменка','Прогресс']);
  h.state.points.forEach((point,i)=>Object.assign(point,{lat:50+i/100,lon:82+i/100}));
  await h.update();assert.equal(h.state.locates.length,0);assert.equal(h.state.routes[0].length,3);
  assert.deepEqual(h.state.routes[0][1],{lat:50.01,lon:82.01});assert.equal(h.getQuote().priceAmount,2600);
});
test('a changing tariff reuses distance but non-price edits do not replace the visible quote',async()=>{
  const h=harness();await h.update();const before=h.getQuote();await h.update();assert.deepEqual(h.getQuote(),before);
  h.state.adjustment=scarcity;assert.equal(h.getQuote(),null);await h.update();
  assert.equal(h.getQuote().priceAmount,3400);assert.equal(h.state.routes.length,1);
  h.state.points[0].address+=' дом 18';assert.equal(h.getQuote(),null);await h.update();assert.equal(h.state.routes.length,2);
});
test('late routing and model replies cannot overwrite a new destination or new tariff',async()=>{
  const h=harness();const slow=deferred();h.state.meters=()=>slow.promise;
  const old=h.update();await tick();h.state.points[1].address='Новый адрес';h.state.meters=12000;
  await h.update();assert.equal(h.getQuote().priceAmount,3000);slow.resolve(40000);await old;
  assert.equal(h.getQuote().priceAmount,3000);
  const q=h.getQuote();h.state.points[0].address='Другой магазин';assert.equal(h.getQuote(),null);assert.ok(q.priceAmount);
});
test('route errors do not use straight-line distance or a local/published fare; retry can recover',async()=>{
  const h=harness();h.state.meters=null;await h.update();assert.equal(h.getState(),'unavailable');assert.equal(h.getQuote(),null);
  h.state.meters=10000;await h.update();assert.equal(h.getQuote().priceAmount,2600);
  const local=harness(['Секисовка','Секисовка']);await local.update();assert.equal(local.getQuote().priceAmount,1200);assert.equal(local.state.routes.length,0);
});
test('missing pickup selects a random displayed car and pins it across movement, coefficients and any-store selection',async()=>{
  const h=harness();h.state.points[0].address='';
  h.state.cars=[{lat:50.4,lon:82.7},{lat:50.14,lon:82.529},{lat:NaN,lon:82.5}];
  await h.update();assert.equal(h.getState(),'preview');assert.equal(h.getQuote(),null);
  const estimate=h.getEstimate();assert.equal(estimate.priceAmount,2600);assert.equal(estimate.distanceMeters,10000);
  assert.equal(estimate.origin.lon,82.7,'Random choice need not be nearest');assert.match(estimate.calculation,/движение смоделировано/);
  assert.equal(h.state.routes[0][0].lon,82.7);
  h.state.cars[0].lon=82.8;await h.update();assert.equal(h.getEstimate().origin.lon,82.7,'Keep preview stable while cars animate');
  h.state.adjustment=scarcity;await h.update();assert.equal(h.getEstimate().priceAmount,3400);assert.equal(h.getEstimate().origin.lon,82.7);
  h.state.points[0].address='Магазин';await h.update();assert.equal(h.getState(),'ready');assert.equal(h.getQuote().anyStore,true);
  assert.equal(h.getQuote().priceAmount,3400);assert.equal(h.state.randomCalls,1);assert.equal(h.state.routes.length,1);
  assert.equal(h.state.locates.some(p=>/магазин/iu.test(p.address)),false,'Generic shop is never geocoded');
  h.state.points[0].address='Магазин Центральный, 7';await h.update();assert.equal(h.getQuote().anyStore,undefined);
});
test('only generic shop names use random origin; a real address or a map point keeps its actual location',()=>{
  for(const address of ['магазин','  Любой магазин  ','из любого магазина','в любом магазине']) assert.equal(deliveryPickupMode({address}),'anyStore');
  for(const address of ['Магазин Центральный','магазин, 8','Панфилова, 32']) assert.equal(deliveryPickupMode({address}),'address');
  assert.equal(deliveryPickupMode({address:'магазин',lat:50,lon:82}),'address');
  assert.equal(deliveryPickupMode({address:''}),'missing');
  const cars=[{lat:NaN,lon:82},{lat:50,lon:82},{lat:51,lon:83}];
  assert.deepEqual(randomMapCar(cars,()=>0),{lat:50,lon:82});
  assert.deepEqual(randomMapCar(cars,()=>0.999),{lat:51,lon:83});
  assert.equal(randomMapCar([],()=>0),null);
});
test('no displayed car or unknown car settlement cannot produce a made-up delivery estimate',async()=>{
  for (const kind of ['noCars','unknownCity','noRoad']) {
    const h=harness();h.state.points[0].address='';
    if(kind==='noCars')h.state.cars=[];if(kind==='unknownCity')h.state.city=null;if(kind==='noRoad')h.state.meters=null;
    await h.update();assert.equal(h.getState(),'unavailable');assert.equal(h.getEstimate(),null);assert.equal(h.getQuote(),null);
  }
  assert.equal(randomMapCar([]),null);
});
test('a late preview origin cannot replace a confirmed pickup',async()=>{
  const slow=deferred();const state={points:points('Белоусовка','Прогресс'),adjustment:standard};state.points[0].address='';
  const h=createDeliveryPricing({tariff,readInput:()=>state,readCars:()=>[{lat:50,lon:82}],locateCarCity:()=>slow.promise,
    locate:async()=>({lat:50.1,lon:82.1}),routeDistance:async()=>10000,onChange:()=>{},wait:async()=>{}});
  const old=h.update();await tick();state.points[0].address='Реальный магазин';await h.update();
  assert.equal(h.getState(),'ready');slow.resolve('Белоусовка');await old;assert.equal(h.getState(),'ready');assert.equal(h.getQuote().preview,undefined);
});
