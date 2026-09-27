import test from 'node:test';
import assert from 'node:assert/strict';
import { assistanceDetails } from '../assistance-booking.js';
import { minimumOffer, offerFields, priceSettings, priceDescription } from '../customer-pricing.js';
import { navigationRoute } from '../booking-route.js';
import { allowedOrderServices, eligiblePushDevice } from '../functions/driver-services.mjs';
import { driverCanServeOrder } from '../vehicle-categories.js';
const config=priceSettings(),order={serviceType:'assistance'};
test('assistance has a 1500 minimum and an explicit client offer, without invented route calculation',()=>{
 assert.equal(minimumOffer('assistance',null,config),1500);
 for(const amount of [null,0,-1,1499,1500.5,Infinity])assert.throws(()=>offerFields(null,amount,'assistance',config));
 const fields=offerFields(null,2200,'assistance',config);assert.equal(fields.priceAmount,2200);assert.equal(fields.calculatedPrice,null);
 assert.match(priceDescription({...order,...fields}),/Предложение клиента/);assert.doesNotMatch(priceDescription({...order,...fields}),/Расстояние|недоступна/);
});
test('other assistance requires details; hidden car data is not carried over',()=>{
 assert.throws(()=>assistanceDetails({assistanceType:'Прочее поручение/помощь',task:' '}));
 assert.throws(()=>assistanceDetails({assistanceType:'Unknown'}));
 assert.deepEqual(assistanceDetails({assistanceType:'Прочее поручение/помощь',task:' Нужна помощь на месте ',carModel:'Old car',licencePlate:'Old plate'}),{assistanceType:'Прочее поручение/помощь',task:'Нужна помощь на месте',carModel:'',licencePlate:''});
 assert.throws(()=>assistanceDetails({assistanceType:'Подкачать колесо',task:'x'.repeat(701)}));
});
test('navigation goes to the actual pickup point, never to the service label or stale destination',()=>{
 const request={...order,fromAddress:'Точка на карте: 50.2, 82.6',toAddress:'Помощь: Подкачать колесо',routeCoordinates:[{lat:50.20147,lon:82.61714},null]};
 assert.equal(navigationRoute(request,[request.fromAddress,request.toAddress]),'~50.20147,82.61714');
 assert.equal(navigationRoute({...order,fromAddress:'Чапаева көшесі, у трассы'},[]),'~Чапаева көшесі, у трассы');
});
test('assistance requires dispatcher opt-in for list, acceptance and push; paused profiles receive nothing',()=>{
 const driver={authUid:'uid',status:'active',assistanceEnabled:true},sub={uid:'uid',driverId:'27',token:'test'},account={active:true,driverId:'27'};
 assert.ok(allowedOrderServices(driver).includes('assistance'));assert.ok(driverCanServeOrder(driver,order));assert.ok(eligiblePushDevice(sub,account,driver,'',order));
 for(const patch of [{assistanceEnabled:false},{passengerStatus:'blocked'},{passengerEnabled:false}]){const d={...driver,...patch};assert.equal(allowedOrderServices(d).includes('assistance'),false);assert.equal(driverCanServeOrder(d,order),false);assert.equal(eligiblePushDevice(sub,account,d,'',order),false);}
 assert.equal(eligiblePushDevice(sub,{...account,active:false},driver,'',order),false);
 assert.equal(allowedOrderServices({}).includes('assistance'),false);
});
