import test from 'node:test';
import assert from 'node:assert/strict';
import { soberQuote, createSoberPricing } from '../sober-pricing.js';
import { SOBER_BASE, soberFareForPrice, soberWorkAmount } from '../sober-fare.js';
import { offerFields, priceSettings } from '../customer-pricing.js';
import { reserveCommission, fundingFor, orderCommission } from '../driver-finance.js';
import { allowedOrderServices, eligiblePushDevice } from '../functions/driver-services.mjs';
import { driverCanServeOrder } from '../vehicle-categories.js';

test('sober minimum funds work after both taxi expenses; road km are charged only for the transfer',()=>{
  assert.deepEqual(soberQuote(800,800,1000),{pickupAmount:800,returnAmount:800,workAmount:2200,priceAmount:3800,distanceMeters:1000,priceText:'3800 ₸'});
  assert.equal(soberQuote(1000,2000,10000).priceAmount,5300);
  assert.equal(soberQuote(1000,2000,10000.5).workAmount,2301);
  for (const args of [[null,800,1000],[800,null,1000],[800,800,null],[800,800,-1]]) assert.equal(soberQuote(...args),null);
});
function harness() {
  const state={input:{points:[{address:'A',city:'Белоусовка',lat:50.14,lon:82.54},{address:'B',city:'Глубокое',lat:50.2,lon:82.6}],multiplier:1},calls:[]};
  const controller=createSoberPricing({readInput:()=>state.input,wait:async()=>{},locate:async()=>null,
    taxiTariff:{BASE_PRICE:800,INTERCITY_PRICE_PER_KM:230},rates:[{name:'Глубокое',min:2000,max:2500}],
    routeDistance:async points=>{state.calls.push(points);return state.measure?state.measure(points):points[0].lat===SOBER_BASE.lat?2000:10000;},onChange:()=>{}});
  return {state,...controller};
}
test('published taxi maximum precedes road fallback, applies multiplier once, uses the Belousovka base',async()=>{
  const h=harness();h.state.input.multiplier=1.25;await h.update();
  assert.equal(h.getQuote().pickupAmount,1000);assert.equal(h.getQuote().returnAmount,3125);assert.equal(h.getQuote().workAmount,2300);assert.equal(h.getQuote().priceAmount,6425);
  assert.equal(h.state.calls.length,2);assert.equal(h.state.calls[0][0].lat,SOBER_BASE.lat);
});
test('unknown free-text route allows pending manual fare; late old route cannot replace new quote',async()=>{
  const h=harness();h.state.input.points[0]={address:'Трасса, у поля',city:''};await h.update();assert.equal(h.getState(),'unavailable');assert.equal(h.getQuote(),null);
  let release, started;const startedPromise=new Promise(resolve=>{started=resolve;});const old=harness();old.state.measure=()=>new Promise(resolve=>{release=resolve;started();});
  old.state.input.points[1].city='Глубокое';old.state.input.points[0].city='Глубокое';
  const pending=old.update();await startedPromise;
  old.state.input.points[1].address='Новый адрес';old.state.measure=()=>1000;await old.update();const next=old.getQuote();release(50000);await pending;assert.deepEqual(old.getQuote(),next);
});
test('own final price preserves transit costs; commission and debt funding use only work including the offer increase',()=>{
  const driver={balance:-1000,commissionRate:20,debtMode:'none',debtLimit:0};
  const order={serviceType:'soberDriver',...offerFields(5300,6000,'soberDriver',priceSettings(),'sober_route'),soberFare:soberFareForPrice({pickupAmount:1000,returnAmount:2000},6000)};
  assert.equal(soberWorkAmount(order),3000);assert.equal(fundingFor(driver,6000,order).amount,600);assert.ok(fundingFor(driver,6000,order).allowed);
  const accepted={...order,...reserveCommission(driver,6000,order)};assert.deepEqual(orderCommission(accepted),{rate:20,baseAmount:3000,amount:600});
  assert.equal(orderCommission({...accepted,commissionRate:90}).amount,600);
  assert.throws(()=>orderCommission({...accepted,priceAmount:6001}));
  assert.equal(reserveCommission({...driver,commissionRate:0},6000,order).commissionTerms.amount,0);
});
test('unavailable or unaffordable transit never changes the customer offer; dispatcher confirms costs before acceptance',()=>{
  for (const expenses of [null,{pickupAmount:2500,returnAmount:2500}]) {
    const order={serviceType:'soberDriver',...offerFields(null,4000,'soberDriver',priceSettings()),soberFare:soberFareForPrice(expenses,4000)};
    assert.equal(order.priceAmount,4000);assert.equal(soberWorkAmount(order),null);assert.equal(fundingFor({balance:0},4000,order).allowed,false);assert.throws(()=>reserveCommission({balance:0},4000,order));
  }
  for (const amount of [null,0,-1,3799,4000.5,1000001]) assert.throws(()=>offerFields(null,amount,'soberDriver',priceSettings()));
});
test('sober orders and push require dispatcher opt-in, active passenger card and linked identity',()=>{
  const order={serviceType:'soberDriver'},driver={status:'active',authUid:'u'},sub={uid:'u',driverId:'30',token:'t'},account={active:true,driverId:'30'};
  assert.equal(allowedOrderServices(driver).includes('soberDriver'),false);assert.equal(driverCanServeOrder(driver,order),false);assert.equal(eligiblePushDevice(sub,account,driver,'',order),false);
  const ready={...driver,soberDriverEnabled:true};assert.equal(driverCanServeOrder(ready,order),true);assert.equal(eligiblePushDevice(sub,account,ready,'',order),true);
  assert.equal(allowedOrderServices({...ready,passengerStatus:'paused'}).includes('soberDriver'),false);
});
