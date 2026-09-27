import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { initBookingScreen } from '../../booking-screen.js';
import { initClientHome } from '../../client-home.js';
import { initialCargoFare, cargoAmount } from '../../cargo-fare.js';
import { createCargoWorkControls } from '../../cargo-controls.js';
import { addressWithCity } from '../../booking-core.js';
const dom=new JSDOM(await readFile(new URL('../../index.html',import.meta.url),'utf8'),{url:'https://example.test/',pretendToBeVisual:true});
for(const key of ['window','document','MutationObserver','Option','HTMLElement']) globalThis[key]=key==='window'?dom.window:dom.window[key];
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
Object.defineProperty(navigator,'geolocation',{value:{getCurrentPosition:()=>{}},configurable:true});
globalThis.fetch=async()=>({ok:true,json:async()=>({features:[]})});
window.openModal=()=>{};window.closeModal=()=>{};window.initSimulationMap=async()=>{};window.scrollTo=()=>{};
window.HTMLElement.prototype.scrollIntoView=()=>{};
window.updateTaxiPrice=()=>{};window.updateDeliveryPrice=()=>{};window.updateCargoPrice=()=>{};window.updateSoberPrice=()=>{};
const get=id=>document.getElementById(id),flush=()=>new Promise(resolve=>setTimeout(resolve,0));
initBookingScreen();initClientHome();
window.repeatOrder('Чапаева көшесі (Белоусовка)','Полевой поворот (Глубокое)');
document.querySelector('[data-booking-service="cargo"]').click();
assert.equal(get('bookingSubmit').disabled,true);
window.cargoBookingReady=true;window.dispatchEvent(new window.Event('cargo-booking-ready'));await flush();
assert.equal(get('bookingSubmit').disabled,false);assert.equal(get('bookingPriceCaption').textContent,'Предварительная стоимость');
get('cargoCustomerPhone').value='+77000000000';get('cargoCustomerPhone').dispatchEvent(new window.Event('input'));
get('cargoDescription').value='Коробки';get('cargoMovers').value='0';
const source=await readFile(new URL('../../client-orders.js',import.meta.url),'utf8');
function extract(name) {const a=source.indexOf(`async function ${name}(`),b=source.indexOf('\nasync function ',a+1);assert.ok(a>=0);return source.slice(a,b);}
let resolveAuth;const authReady=new Promise(resolve=>resolveAuth=resolve);
const writes=[],statuses=[],seen=[];let busy=false;
const view={customerPhone:get('cargoCustomerPhone'),customerName:get('cargoCustomerName'),form:get('cargoForm')};
const context={window,document,ONLINE_ORDERS_ENABLED:true,actionInProgress:false,activeOrderView:'',resumeExistingOrder:()=>false,orderView:()=>view,
 setStatus:message=>statuses.push(message),combineAddress:()=>get('cargoFrom').value,normalizePhone:value=>value,validPhone:value=>value.length>8,
 initialCargoFare,cargoAmount,addressWithCity,coordinateFields:route=>({routeCoordinates:route.coordinates}),prepareClientOrderSound:async()=>{},
 setActionBusy:value=>{busy=value;},ensureSignedIn:()=>authReady,customerOrderReference:()=>({id:'cargo-test'}),customerOrderBatch:()=>({set:(ref,data)=>writes.push({ref,data}),commit:async()=>{}}),
 doc:(_db,...path)=>({id:path.join('/')}),db:{},createOrderNumber:()=> 'TU-CARGO',serverTimestamp:()=> 'server-time',storeValue:()=>{},
 CUSTOMER_NAME_STORAGE_KEY:'name',CUSTOMER_PHONE_STORAGE_KEY:'phone',startOrderWatch:id=>seen.push(id),pendingSubmission:()=>null,console};
const submit=Function(...Object.keys(context),extract('createOnlineCargoOrder')+';return createOnlineCargoOrder;')(...Object.values(context));
let inFlight;get('cargo-online-order-button').addEventListener('click',()=>{inFlight=submit();});
get('bookingSubmit').click();assert.equal(busy,true);
// A delayed sign-in must not swap the cargo description, price, or route after the user clicked.
get('cargoDescription').value='Изменено позже';get('cargoMovers').value='2';resolveAuth({uid:'client'});await inFlight;await flush();
assert.equal(writes.length,2);const order=writes[0].data;
assert.equal(order.serviceType,'cargo');assert.equal(order.priceAmount,6000);assert.equal(order.cargoFare.moversCount,0);
assert.equal(order.serviceDetails.description,'Коробки');assert.match(order.fromAddress,/Чапаева/);assert.equal(order.status,'searching');
assert.deepEqual(seen,['cargo-test']);assert.equal(busy,false);assert.equal(statuses.filter(Boolean).length,0);
get('cargo-online-order-panel').classList.remove('hidden');get('cargo-online-order-status').textContent='Диспетчер проверяет пробег';await flush();
assert.equal(get('bookingFooter').hidden,true);assert.match(document.querySelector('[data-home-current]').textContent,/проверяет пробег/);
const ts=ms=>({seconds:ms/1000});const job={status:'in_trip',cargoFare:initialCargoFare(),cargoStartedAt:ts(Date.now()-90*60000)};
let command;const editor=createCargoWorkControls(job,async value=>{command=value;});document.body.append(editor);
const input=editor.querySelector('input'),form=editor.querySelector('form');input.value='-5';form.dispatchEvent(new window.Event('submit',{cancelable:true}));await flush();assert.equal(command,undefined);
input.value='5,2';input.dispatchEvent(new window.Event('input'));assert.match(editor.textContent.replace(/\s/g,''),/7300₸/);
form.dispatchEvent(new window.Event('submit',{cancelable:true}));await flush();assert.equal(command.meters,5200);assert.equal(command.action,'report');
const pending={...job,cargoFinishedAt:ts(Date.now()),cargoReportedMeters:5200};
assert.equal(createCargoWorkControls(pending,()=>{}).querySelector('input'),null);
const approval=createCargoWorkControls(pending,async value=>{command=value;},true);document.body.append(approval);
assert.equal(approval.querySelector('input').value,'5.2');approval.querySelector('input').value='5';approval.querySelector('form').dispatchEvent(new window.Event('submit',{cancelable:true}));await flush();
assert.equal(command.action,'confirm');assert.equal(command.meters,5000);assert.equal(command.expectedReportedMeters,5200);
console.log('PASS: cargo backend gate, manual-address submit, snapshot before sign-in, current-order restoration, decimal mileage and dispatcher correction');
await new Promise(resolve=>setTimeout(resolve,1100));dom.window.close();
