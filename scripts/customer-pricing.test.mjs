import test from 'node:test';
import assert from 'node:assert/strict';
import { priceSettings, offerFields, minimumOffer, validOffer, priceDescription } from '../customer-pricing.js';
import { distanceFare } from '../taxi-pricing.js';
import { reserveCommission, orderCommission } from '../driver-finance.js';
const config = priceSettings();
test('standard, increased and unavailable quotes retain distinct source values', () => {
  assert.deepEqual([offerFields(4232,null,'taxi',config).priceAmount,offerFields(4232,5000,'taxi',config).calculatedPrice],[4232,4232]);
  const fallback = offerFields(null,1200,'delivery',config);
  assert.equal(fallback.calculatedPrice,null);assert.equal(fallback.pricingType,'customer_offer_unavailable');assert.equal(fallback.priceAmount,1200);
  assert.match(priceDescription(fallback),/Расстояние не рассчитано/);
  assert.throws(()=>offerFields(null,1199,'delivery',config));assert.throws(()=>offerFields(4232,4000,'taxi',config));
});
test('manual amounts are exact, never surged or rounded again; commission uses accepted offer', () => {
  const order=offerFields(3496,3701,'taxi',config);Object.assign(order,reserveCommission({commissionRate:15,balance:0,debtMode:'unlimited',debtLimit:0},order.priceAmount));
  assert.equal(order.priceAmount,3701);assert.equal(orderCommission(order).amount,555.15);
  assert.equal(order.calculatedPrice,3496);
});
test('minimums, strict increases, bounded integer amounts and configurable controls', () => {
  const c=priceSettings({quickPercentages:[],minimumIncrease:100});assert.deepEqual(c.quickPercentages,[]);
  assert.equal(minimumOffer('taxi',3496,c),3496);assert.equal(minimumOffer('taxi',3496,c,4000),4100);
  for(const invalid of [NaN,Infinity,1.5,-1,0,10000001]) assert.equal(validOffer(invalid,800,c),false);
  assert.throws(()=>priceSettings({quickPercentages:[101]}));assert.throws(()=>offerFields(1000,1200,'taxi',priceSettings({enabled:false})));
});
test('road tariff matches 800 minimum and exact whole-tenge examples', () => {
  const tariff={BASE_PRICE:800,INTERCITY_PRICE_PER_KM:230};
  assert.equal(distanceFare(15200,tariff,1,false),3496);assert.equal(distanceFare(18400,tariff,1,true),4232);
  assert.equal(distanceFare(1000,tariff,1,false),800);assert.equal(distanceFare(null,tariff,1,false),null);
  assert.equal(distanceFare(0,tariff,1,false),null);
});
