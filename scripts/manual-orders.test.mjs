import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { offerFields, priceSettings } from '../customer-pricing.js';
import { addressWithCity } from '../booking-core.js';

const source=await readFile(new URL('../client-orders.js',import.meta.url),'utf8');
const section=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const handlers=section('async function createOnlineOrder()', 'const PENDING_SUBMISSION_KEY')
  + section('function containsRestrictedDeliveryItems', 'async function cancelOnlineOrder()')
  + section('function coordinateFields(', 'async function loadBookingCoordinates()');

function harness(service,amount=1701) {
  const route={from:{address:'Чапаева көшесі, у поворота',city:''},to:{address:'Точка на карте: 50.12345, 82.54321',city:''},
    stops:[{address:'Трасса у магазина',city:''}],coordinates:[null,null,{lat:50.12345,lon:82.54321}]};
  const nodes=Object.fromEntries(Object.entries({taxiTo:route.to.address,taxiDateTime:'',taxiWishes:'Позвонить у поворота',
    deliveryItems:'Хлеб',deliveryStore:route.from.address}).map(([id,value])=>[id,{value}]));
  const state={writes:[],messages:[],amount,quote:null,auth:async()=>({uid:'client'}),route};
  const window={customerPricingReady:true,bookingCoordinatesReady:true,customerPriceSettings:priceSettings(),
    bookingScreen:{isPreview:()=>false,vehicleRequest:()=>({vehicleCategory:'sedan',passengerCount:1}),
      orderRoute:()=>structuredClone(state.route),deliveryData:()=>({stops:route.stops.map(p=>p.address),wishes:'Позвонить у поворота'})},
    getCustomerPriceSelection:()=>({amount:state.amount,calculatedPrice:null}),getTaxiPriceState:()=> 'pending',getDeliveryPriceState:()=> 'pending',
    getTaxiFareForOrder:()=>state.quote,getDeliveryFareForOrder:()=>state.quote};
  const contact={value:'+77000000000'};
  const ctx=vm.createContext({window,console,offerFields,addressWithCity,
    document:{getElementById:id=>nodes[id]},ONLINE_ORDERS_ENABLED:true,actionInProgress:false,activeOrderView:'',resumeExistingOrder:()=>false,
    setStatus:message=>state.messages.push(message),combineAddress:()=>service==='taxi'?route.from.address:route.to.address,
    elements:{customerName:{value:'Тест'},customerPhone:contact,deliveryCustomerName:{value:'Тест'},deliveryCustomerPhone:contact},
    normalizePhone:x=>x||'',validPhone:()=>true,prepareClientOrderSound:()=>{},setActionBusy:()=>{},ensureSignedIn:()=>state.auth(),
    db:{},doc:(...args)=>({id:args.at(-1)}),createOrderNumber:()=> 'TU-TEST',collectStops:()=>[],
    customerOrderReference:()=>({id:'client_attempt'}),customerOrderBatch:()=>({set:(ref,data)=>state.writes.push(data),commit:async()=>{}}),
    serverTimestamp:()=> 'now',storeValue:()=>{},startOrderWatch:()=>{},CUSTOMER_NAME_STORAGE_KEY:'name',CUSTOMER_PHONE_STORAGE_KEY:'phone',
    pendingSubmission:()=>null});
  vm.runInContext(handlers,ctx);
  return {state,window,nodes,submit:()=>vm.runInContext(service==='taxi'?'createOnlineOrder()':'createOnlineDeliveryOrder()',ctx)};
}

for (const service of ['taxi','delivery']) {
  test(`${service}: actual handler keeps custom amount, manual text, coordinates and stops through delayed authentication`,async()=>{
    const h=harness(service);let finish;h.state.auth=()=>new Promise(resolve=>{finish=resolve;});
    const pending=h.submit();h.state.amount=9000;h.state.quote={priceMax:8000,priceAmount:8000};
    h.state.route.to.city='Не подставлять';h.state.route.coordinates[2].lat=51;
    h.nodes.taxiWishes.value='Не подставлять';finish({uid:'client'});await pending;
    const order=h.state.writes[0];
    assert.equal(order.priceAmount,1701);assert.equal(order.customerOfferPrice,1701);assert.equal(order.calculatedPrice,null);
    assert.equal(order.finalDisplayedPrice,1701);assert.equal(order.pricingType,'customer_offer_unavailable');
    assert.equal(order.toAddress,'Точка на карте: 50.12345, 82.54321');assert.equal(order.routeCoordinates[2].lat,50.12345);
    assert.equal(order.stops[0],'Трасса у магазина');assert.equal(order.wishes,'Позвонить у поворота');
    assert.equal(h.state.writes.length,2);assert.doesNotMatch(order.fromAddress,/Белоусовка/);
  });
  test(`${service}: invalid manual amounts cannot reach the write`,async()=>{
    for(const amount of [null,0,-1,799,1.5,1000001,NaN,Infinity]) {
      const h=harness(service,amount);await h.submit();assert.equal(h.state.writes.length,0,`amount ${amount}`);
    }
  });
  test(`${service}: old rules omit only the optional coordinate field and retain the coordinate address`,async()=>{
    const h=harness(service);h.window.bookingCoordinatesReady=false;await h.submit();
    assert.equal('routeCoordinates' in h.state.writes[0],false);
    assert.equal(h.state.writes[0].toAddress,'Точка на карте: 50.12345, 82.54321');
  });
}
