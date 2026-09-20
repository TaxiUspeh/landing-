import test from 'node:test';
import assert from 'node:assert/strict';
import { allowedOrderServices, serviceEnabled, profileForOrder, assignmentVehicle, eligiblePushDevice, validCargoProfile } from '../functions/driver-services.mjs';
import { driverCanServeOrder } from '../vehicle-categories.js';
import { fundingFor, reserveCommission, hasOrderFunds } from '../driver-finance.js';
const cargo = {status:'active',car:'Газель',color:'Белый',plate:'TEST',bodyType:'Фургон',dimensions:'3 × 2 × 2',payloadKg:1500,commissionRate:5};
const person = {authUid:'uid',status:'active',name:'Водитель',car:'Легковой',color:'Синий',balance:-100,commissionRate:20,debtMode:'none',debtLimit:0};
test('legacy, cargo-only and shared identities have the intended directions',()=>{
 assert.equal(driverCanServeOrder(person,{serviceType:'cargo'}),false);
 const shared={...person,cargoProfile:cargo};assert.ok(driverCanServeOrder(shared,{serviceType:'taxi'}));assert.ok(driverCanServeOrder(shared,{serviceType:'cargo'}));
 assert.deepEqual(allowedOrderServices({...shared,passengerEnabled:false}),['cargo']);
 assert.equal(driverCanServeOrder({...shared,passengerEnabled:false},{serviceType:'auction'}),false);
 assert.equal(serviceEnabled({...shared,passengerStatus:'paused'}),false);assert.ok(serviceEnabled({...shared,passengerStatus:'paused'},'cargo'));
});
test('cargo assignment uses its vehicle and preserves identity and shared funds',()=>{
 const driver={...person,cargoProfile:cargo}, order={serviceType:'cargo'};
 assert.deepEqual(assignmentVehicle(driver,order),{driverCar:'Газель · TEST',driverColor:'Белый'});
 assert.equal(profileForOrder(driver,order).authUid,'uid');assert.equal(profileForOrder(driver,order).balance,-100);
 assert.equal(fundingFor(driver,2000,order).allowed,true);assert.equal(fundingFor(driver,2000,{serviceType:'taxi'}).allowed,false);
 assert.deepEqual(reserveCommission(driver,2000,order),{commissionTerms:{rate:5,baseAmount:2000,amount:100}});
 assert.equal(hasOrderFunds({...driver,passengerEnabled:false,balance:0}),false);
 assert.equal(hasOrderFunds({...driver,passengerEnabled:false,balance:0,cargoProfile:{...cargo,commissionRate:0}}),true);
});
test('push routes both services to one shared account and rejects wrong or blocked accounts',()=>{
 const sub={uid:'uid',driverId:'30',token:'device'},account={active:true,driverId:'30'},shared={...person,cargoProfile:cargo};
 for(const serviceType of ['taxi','cargo'])assert.ok(eligiblePushDevice(sub,account,shared,'',{serviceType}));
 assert.equal(eligiblePushDevice(sub,account,person,'',{serviceType:'cargo'}),false);
 assert.equal(eligiblePushDevice(sub,account,{...shared,passengerEnabled:false},'',{serviceType:'taxi'}),false);
 assert.equal(eligiblePushDevice(sub,account,{...shared,cargoProfile:{...cargo,status:'blocked'}},'',{serviceType:'cargo'}),false);
 for(const [a,d] of [[{active:false,driverId:'30'},shared],[{active:true,driverId:'31'},shared],[account,{...shared,status:'blocked'}],[account,{...shared,authUid:'other'}]])assert.equal(eligiblePushDevice(sub,a,d,'',{serviceType:'cargo'}),false);
 assert.equal(eligiblePushDevice(sub,account,shared,'other',{serviceType:'cargo'}),false);
});
test('active cargo cards require real vehicle and capacity; drafts grant no orders',()=>{
 assert.ok(validCargoProfile(cargo));assert.equal(validCargoProfile({...cargo,car:''}),false);assert.equal(validCargoProfile({...cargo,payloadKg:0}),false);assert.equal(validCargoProfile({...cargo,commissionRate:101}),false);
 assert.ok(validCargoProfile({...cargo,car:'',payloadKg:0,status:'paused'}));assert.equal(serviceEnabled({cargoProfile:{...cargo,status:'paused'}},'cargo'),false);
});
