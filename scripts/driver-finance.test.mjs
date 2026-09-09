import test from 'node:test';
import assert from 'node:assert/strict';
import { financeSettings, validFinanceSettings, commissionFor, fundingFor, reserveCommission, orderCommission, reservedCommission, hasOrderFunds } from '../driver-finance.js';
test('legacy defaults stay 20% and unlimited; arbitrary integer percentages are accepted',()=>{
 assert.deepEqual(financeSettings({}),{commissionRate:20,debtMode:'unlimited',debtLimit:0});
 for(const rate of [0,5,15,20,30,100])assert.ok(validFinanceSettings({commissionRate:rate,debtMode:'none',debtLimit:0}));
 for(const rate of [-1,101,5.5,NaN])assert.equal(validFinanceSettings({commissionRate:rate,debtMode:'none',debtLimit:0}),false);
});
test('100 credit and 5000 fare respect none, 500, 1000 and unlimited modes',()=>{
 const d={balance:-100,commissionRate:20,debtMode:'limited',debtLimit:1000};
 assert.ok(fundingFor(d,5000).allowed);assert.equal(fundingFor({...d,debtLimit:500},5000).shortfall,400);
 assert.equal(fundingFor({...d,debtMode:'none',debtLimit:0},5000).shortfall,900);
 assert.ok(fundingFor({...d,balance:100000,debtMode:'unlimited',debtLimit:0},5000).allowed);
});
test('exact limit, repayment and zero commission are deterministic',()=>{
 const d={balance:1000,commissionRate:20,debtMode:'limited',debtLimit:1000};
 assert.equal(hasOrderFunds(d),false);assert.ok(hasOrderFunds({...d,balance:999}));
 assert.ok(hasOrderFunds({...d,commissionRate:0}));assert.equal(hasOrderFunds({...d,balance:1001,commissionRate:0}),false);
 assert.ok(fundingFor({...d,balance:0},5000).allowed);
 assert.equal(commissionFor(501,5),25.05);
});
test('reservation freezes rate; cancellation and completion release it without altering the snapshot',()=>{
 const driver={balance:-100,commissionRate:15,debtMode:'limited',debtLimit:1000};
 const order={status:'accepted',priceAmount:5000,...reserveCommission(driver,5000)};
 driver.commissionRate=30;assert.equal(orderCommission(order).rate,15);assert.equal(reservedCommission([order]),750);
 assert.equal(reservedCommission([{...order,status:'cancelled'}]),0);assert.equal(reservedCommission([{...order,status:'completed'}]),0);
 assert.throws(()=>reserveCommission({...driver,debtLimit:100},5000),/Пополните/);
 assert.throws(()=>orderCommission({...order,priceAmount:6000}),/повреждены/);
});
