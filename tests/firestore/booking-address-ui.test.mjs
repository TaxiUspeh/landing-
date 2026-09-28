import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { initBookingScreen } from '../../booking-screen.js';
import { photonPoint } from '../../booking-core.js';

const dom = new JSDOM(await readFile('../../index.html', 'utf8'), { url:'https://example.test/', pretendToBeVisual:true });
for (const key of ['window','document','MutationObserver','Option','HTMLElement']) globalThis[key] = key === 'window' ? dom.window : dom.window[key];
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
Object.defineProperty(navigator,'geolocation',{value:{getCurrentPosition(){}},configurable:true});
window.openModal=()=>{};window.closeModal=()=>{};window.initSimulationMap=async()=>{};
for(const service of ['Taxi','Delivery','Cargo','Sober']) window[`update${service}Price`]=()=>{};
globalThis.fetch=async()=>({ok:true,json:async()=>({code:'NoRoute'})});
const get=id=>document.getElementById(id), flush=()=>new Promise(resolve=>setTimeout(resolve,0));
const street=photonPoint({geometry:{coordinates:[82.53,50.13]},properties:{city:'Белоусовка',street:'Жукова',housenumber:'20',countrycode:'KZ'}});
const settlement=photonPoint({geometry:{coordinates:[82.5,50.1]},properties:{osm_key:'place',osm_value:'village',name:'Белоусовка',countrycode:'KZ'}});
let reverse=async()=>[street], search=async()=>[];
const calls=[];
initBookingScreen({geocoder:{reverse:(...args)=>reverse(...args),search:(...args)=>{calls.push(args[0]);return search(...args);}}});
window.openModal('taxiModal');
try {
 // A useful response arriving after the former 2.5 second cutoff is still displayed.
 reverse=()=>new Promise(resolve=>setTimeout(()=>resolve([street]),2700));
 get('bookingLocate').click();
 await window.bookingScreen.onLocation({coords:{latitude:50.1301,longitude:82.5301,accuracy:20}});
 assert.equal(get('bookingFromValue').textContent,'Жукова');
 assert.equal(get('bookingDetails').value,'20');
 assert.equal(window.bookingScreen.orderRoute('taxi').from.lat,50.1301,'GPS coordinate is not replaced with geocoder centroid');
 // A known village without a street remains a named place with an exact location.
 reverse=async()=>[settlement];get('bookingLocate').click();
 await window.bookingScreen.onLocation({coords:{latitude:50.131,longitude:82.531,accuracy:20}});
 assert.equal(get('bookingFromValue').textContent,'Белоусовка');
 assert.equal(get('bookingCity').textContent,'Белоусовка');
 assert.match(get('bookingLocationStatus').textContent,/уточните улицу или ориентир/);
 const center={lat:50.132,lng:82.532};
 const marker={addTo(){return this;},setLatLng(){return this;}};
 window.L={marker:()=>marker,divIcon:()=>({})};
 window.simMap={getCenter:()=>center,invalidateSize(){},setView(){},removeLayer(){},fitBounds(){},off(){},on(){}};
 const pick=async()=>{get('bookingTo').click();get('bookingOnMap').click();get('bookingPickConfirm').click();await flush();await flush();};
 await pick();
 assert.equal(get('bookingToValue').textContent,'Белоусовка');
 assert.equal(window.bookingScreen.orderRoute('taxi').to.lat,center.lat);
 assert.equal(window.bookingScreen.orderRoute('taxi').to.lon,center.lng);
 // Empty directory responses and network failures still leave map ordering available.
 for (const response of [async()=>[],async()=>{throw new Error('offline');}]) {
   reverse=response;center.lat+=0.001;await pick();
   assert.match(get('bookingToValue').textContent,/Точка на карте:/);
   assert.equal(get('bookingPicker').hidden,true);assert.equal(get('bookingPickConfirm').disabled,false);
   assert.equal(window.bookingScreen.orderRoute('taxi').to.city,'');
   assert.equal(window.bookingScreen.orderRoute('taxi').to.lat,center.lat);
 }
 // Optional wider search neither delays nor destroys the successful local result.
 let rejectBroad;
 search=query=>query.includes('Белоусовка')?Promise.resolve([street]):new Promise((_,reject)=>{rejectBroad=reject;});
 get('bookingTo').click();get('bookingSearchCity').value='Белоусовка';get('bookingSearchInput').value='Жукова';get('bookingSearchButton').click();await flush();
 assert.equal(get('bookingSearchResults').children.length,1,'local result is visible before broader search finishes');
 rejectBroad(new Error('offline'));await flush();
 assert.equal(get('bookingSearchResults').children.length,1);assert.match(get('bookingSearchStatus').textContent,/Выберите адрес/);
 get('bookingSearchResults').firstElementChild.click();assert.match(get('bookingToValue').textContent,/Жукова/);
 // Broader search can recover from a failed locality query; Kazakh input is preserved.
 search=query=>query.includes('Белоусовка')?Promise.reject(new Error('offline')):Promise.resolve([{...street,address:'Чапаева көшесі',street:'Чапаева көшесі',house:''}]);
 get('bookingTo').click();get('bookingSearchCity').value='Белоусовка';get('bookingSearchInput').value='Чапаева көшесі';get('bookingSearchButton').click();await flush();await flush();
 assert.equal(get('bookingSearchResults').children.length,1);assert.equal(calls.at(-1),'Чапаева көшесі, Казахстан');
 // Finishing an old search cannot change a manually confirmed address or repopulate its picker.
 let resolveSearch;search=()=>new Promise(resolve=>{resolveSearch=resolve;});
 get('bookingSearchInput').value='У поворота';get('bookingSearchButton').click();await flush();get('bookingManualAddress').click();resolveSearch([street]);await flush();
 assert.equal(get('bookingToValue').textContent,'У поворота, Белоусовка');assert.equal(get('bookingPicker').hidden,true);
 console.log('PASS: slow geocoder, settlement labels, exact GPS/map points, no-address fallback, partial search results, Kazakh search and manual input races');
} finally {dom.window.close();}
