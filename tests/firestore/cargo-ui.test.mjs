import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {createCargoControls} from '../../cargo-profile-controls.js';
import {createFinanceControls} from '../../driver-finance-controls.js';
import {createVehicleControls} from '../../vehicle-category-controls.js';
import {profileForOrder} from '../../functions/driver-services.mjs';
import {financeSummary,reservedCommission} from '../../driver-finance.js';
import {driverCategorySummary} from '../../vehicle-categories.js';
const dom = new JSDOM(await readFile(new URL('../../dispatcher.html',import.meta.url),'utf8'));
globalThis.document=dom.window.document;
const source=await readFile(new URL('../../dispatcher.js',import.meta.url),'utf8');
function extract(name){const start=source.indexOf(`function ${name}(`);let end=source.indexOf('\n}',start);assert.ok(start>=0&&end>start);return source.slice(start,end+2);}
const cargo={status:'active',car:'Газель',color:'Белый',plate:'TEST-30',payloadKg:1500,dimensions:'3 × 2 × 2',bodyType:'Фургон',commissionRate:5};
const shared={id:'30',driverNumber:30,name:'Тестовый водитель',phone:'',authUid:'one-account',balance:-500,status:'active',car:'Легковой',color:'Синий',commissionRate:20,debtMode:'unlimited',debtLimit:0,cargoProfile:cargo};
let saved;
const elements=Object.fromEntries(['driversList','driverSearch','driversLoading','driversEmpty'].map(key=>[key,document.getElementById(key.replace(/[A-Z]/g,c=>'-'+c.toLowerCase()))]));
const ctx=vm.createContext({document,profileForOrder,createCargoControls,createFinanceControls,createVehicleControls,driverCategorySummary,financeSummary,reservedCommission,
 driverDirectory:'cargo',drivers:[shared,{...shared,id:'31',driverNumber:31,passengerEnabled:false}],orders:[],elements,
 applyDriverAvailability(){},saveDriver:(driver,controls)=>{saved={driver,controls};},openDriverOrdersReport(){},updateStats(){},driverMatchesSearch:()=>true,
 setHidden:(el,value)=>el.classList.toggle('hidden',value),renderQuickDriverSearch(){}});
vm.runInContext([extract('createInput'),extract('renderDriverCard'),extract('renderDrivers')].join('\n'),ctx);
vm.runInContext('renderDrivers()',ctx);assert.equal(elements.driversList.children.length,2);
let card=elements.driversList.firstElementChild;assert.equal(card.dataset.driverId,'30');assert.equal(card.querySelector('.driver-car').value,'Газель');assert.equal(card.querySelector('[data-cargo-field="payloadKg"]').value,'1500');assert.equal(card.querySelector('.driver-uid').value,'one-account');
[...card.querySelectorAll('button')].find(b=>b.textContent==='Сохранить изменения').click();assert.equal(saved.controls.direction,'cargo');assert.equal(saved.controls.financeControls.read().commissionRate,5);
const entered=saved.controls.vehicleControls.read({...cargo,car:saved.controls.car.value});assert.equal(entered.plate,'TEST-30');assert.equal(entered.payloadKg,1500);
vm.runInContext("driverDirectory='passenger';renderDrivers()",ctx);assert.equal(elements.driversList.children.length,1);card=elements.driversList.firstElementChild;assert.equal(card.querySelector('.driver-car').value,'Легковой');assert.equal(card.querySelector('[data-cargo-field]'),null);
const draft=createCargoControls();assert.throws(()=>draft.read({...cargo}));
console.log('PASS: shared ID and UID, cargo-only directory, separate vehicle and commission controls');
