import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { initBookingScreen } from '../../booking-screen.js';
import { initClientHome } from '../../client-home.js';
import { assistanceDetails } from '../../assistance-booking.js';
import { priceSettings, offerFields } from '../../customer-pricing.js';
import { createVehicleControls } from '../../vehicle-category-controls.js';
const dom=new JSDOM(await readFile(new URL('../../index.html',import.meta.url),'utf8'),{url:'https://example.test/',pretendToBeVisual:true});
for(const key of ['window','document','MutationObserver','Option','HTMLElement']) globalThis[key]=key==='window'?dom.window:dom.window[key];
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
Object.defineProperty(navigator,'geolocation',{value:{getCurrentPosition:()=>{}},configurable:true});
globalThis.fetch=async()=>({ok:true,json:async()=>({features:[]})});
window.openModal=()=>{};window.closeModal=()=>{};window.initSimulationMap=async()=>{};window.scrollTo=()=>{};
window.HTMLElement.prototype.scrollIntoView=()=>{};
for(const name of ['Taxi','Delivery','Cargo','Sober']) window[`update${name}Price`]=()=>{};
const get=id=>document.getElementById(id),flush=()=>new Promise(resolve=>setTimeout(resolve,0));
initBookingScreen();initClientHome();
window.repeatOrder('Чапаева көшесі (Белоусовка)','Старый адрес такси');
document.querySelector('[data-booking-service="assistance"]').click();
assert.equal(get('bookingSubmit').disabled,true);
window.customerPricingReady=true;window.customerPriceSettings=priceSettings();window.assistanceBookingReady=true;
window.dispatchEvent(new window.Event('assistance-booking-ready'));await flush();
assert.equal(get('bookingSubmit').disabled,false);
get('assistanceCustomerPhone').value='+77000000000';get('assistanceCustomerPhone').dispatchEvent(new window.Event('input'));
get('assistanceType').value='Прочее поручение/помощь';get('assistanceType').dispatchEvent(new window.Event('change'));
assert.equal(get('assistanceTask').required,true);assert.ok(get('carDetails').classList.contains('hidden'));
get('assistanceTask').value='Нужен специалист, место возле моста';
get('bookingSubmit').click();
const input=get('booking-offer-amount');assert.equal(input.closest('.customer-price-editor').hidden,false);
assert.match(get('bookingCustomerPrice').textContent,/1 500/);
input.value='1000';input.dispatchEvent(new window.Event('input'));assert.equal(window.getCustomerPriceOffer('assistance'),null);
input.value='2000';input.dispatchEvent(new window.Event('input'));assert.equal(window.getCustomerPriceOffer('assistance'),2000);
assert.match(get('bookingSubmit').textContent.replace(/\s/g,''),/2000₸/);
const source=await readFile(new URL('../../client-orders.js',import.meta.url),'utf8');
const a=source.indexOf('async function createOnlineAssistanceOrder('),b=source.indexOf('\nasync function ',a+1);assert.ok(a>=0);
let resolveAuth;const authReady=new Promise(resolve=>resolveAuth=resolve);
const writes=[],statuses=[],seen=[],history=[];let busy=false;
window.saveOrderToFullHistory=(...args)=>history.push(args);
const context={window,document,ONLINE_ORDERS_ENABLED:true,actionInProgress:false,activeOrderView:'',resumeExistingOrder:()=>false,
 orderView:()=>({customerPhone:get('assistanceCustomerPhone'),customerName:get('assistanceCustomerName')}),
 setStatus:message=>statuses.push(message),combineAddress:()=>get('assistanceAddress').value,normalizePhone:value=>value,validPhone:value=>value.length>8,
 assistanceDetails,customerOrderPricing:(service,calculated,offered,type)=>offerFields(calculated,offered,service,window.customerPriceSettings,type),
 coordinateFields:route=>({routeCoordinates:route.coordinates}),prepareClientOrderSound:async()=>{},setActionBusy:value=>{busy=value;},
 ensureSignedIn:()=>authReady,customerOrderReference:()=>({id:'help-test'}),customerOrderBatch:()=>({set:(ref,data)=>writes.push({ref,data}),commit:async()=>{}}),
 doc:(_db,...path)=>({id:path.join('/')}),db:{},createOrderNumber:()=> 'TU-HELP',serverTimestamp:()=> 'server-time',storeValue:()=>{},
 CUSTOMER_NAME_STORAGE_KEY:'name',CUSTOMER_PHONE_STORAGE_KEY:'phone',startOrderWatch:id=>seen.push(id),pendingSubmission:()=>null,console};
const submit=Function(...Object.keys(context),source.slice(a,b)+';return createOnlineAssistanceOrder;')(...Object.values(context));
let inFlight;get('assistance-online-order-button').addEventListener('click',()=>{inFlight=submit();});
get('bookingSubmit').click();assert.equal(busy,true);
// A delayed sign-in cannot swap the already confirmed task, route or offer.
get('assistanceTask').value='Изменено позже';input.value='3000';input.dispatchEvent(new window.Event('input'));
resolveAuth({uid:'client'});await inFlight;await flush();
assert.equal(writes.length,2);const order=writes[0].data;
assert.equal(order.serviceType,'assistance');assert.equal(order.priceAmount,2000);assert.equal(order.calculatedPrice,null);
assert.equal(order.serviceDetails.task,'Нужен специалист, место возле моста');assert.match(order.fromAddress,/Чапаева/);
assert.equal(order.toAddress,'Помощь: Прочее поручение/помощь');assert.deepEqual(order.stops,[]);assert.equal(order.routeCoordinates[1],null);
assert.equal(order.customerPhone,undefined);assert.equal(writes[1].data.customerPhone,'+77000000000');
assert.deepEqual(seen,['help-test']);assert.equal(busy,false);assert.equal(statuses.filter(Boolean).length,0);assert.equal(history[0][3],'assistance');
get('assistance-online-order-panel').classList.remove('hidden');get('assistance-online-order-status').textContent='Ищем исполнителя';await flush();
assert.equal(get('bookingFooter').hidden,true);assert.match(document.querySelector('[data-home-current]').textContent,/Ищем исполнителя/);
get('assistance-online-order-panel').classList.add('hidden');await flush();
window.repeatOrder('Трасса, 8 км','Помощь: Подкачать колесо','assistance');
assert.equal(window.bookingScreen.orderRoute('assistance').from.address,'Трасса, 8 км');
assert.equal(window.bookingScreen.orderRoute('assistance').to.address,'');
const controls=createVehicleControls({assistanceEnabled:true});assert.equal(controls.read().assistanceEnabled,true);controls.reset();assert.equal(controls.read().assistanceEnabled,false);
console.log('PASS: assistance backend gate, manual address, required offer, immutable submission, private contact, order restoration, history and dispatcher opt-in');
await new Promise(resolve=>setTimeout(resolve,1100));dom.window.close();
