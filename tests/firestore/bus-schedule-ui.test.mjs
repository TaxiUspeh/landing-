import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { initBusSchedule } from '../../bus-schedule.js';
const dom=new JSDOM(await readFile(new URL('../../index.html',import.meta.url),'utf8'));
const document=dom.window.document,find=id=>document.getElementById(id);
let date=new Date('2026-09-25T05:05:00Z'); // Friday, 10:05 in Belousovka.
const beforeUka=find('routeUkaContent').textContent,beforeGlub=find('routeGlubContent').textContent;
const app=initBusSchedule({document,now:()=>date});
function choose(id,value){find(id).value=value;find(id).dispatchEvent(new dom.window.Event('change'));}
try {
 assert.equal(find('routeUkaContent').hidden,false);assert.equal(find('routeLocalContent').hidden,true);
 find('btnRouteLocal').click();assert.equal(find('routeUkaContent').hidden,true);assert.equal(find('routeLocalContent').hidden,false);
 choose('localBusStop','school1');assert.equal(find('localBusNext').querySelector('strong').textContent,'10:10');
 assert.equal(find('localBusTrip').value,'600');assert.match(find('localBusNext').textContent,/через 5 мин/);
 assert.equal(find('localBusRows').children.length,17);assert.match(find('localBusRows').querySelector('.bus-selected-stop').textContent,/10:10Школа №1/);
 choose('localBusTrip','540');assert.match(find('localBusRows').firstElementChild.textContent,/09:00/);assert.match(find('localBusRows').lastElementChild.textContent,/09:30/);
 choose('localBusDirection','inbound');assert.equal(find('localBusStop').value,'school1');assert.equal(find('localBusNext').querySelector('strong').textContent,'10:50');
 assert.equal([...find('localBusStop').options].some(o=>o.value==='college'),false);
 date=new Date('2026-09-26T09:49:00Z');app.refresh();assert.equal(find('localBusNext').querySelector('strong').textContent,'14:50');
 date=new Date('2026-09-26T09:51:00Z');app.refresh();assert.match(find('localBusNext').textContent,/больше нет/);
 choose('localBusDay','weekday');assert.equal(find('localBusNext').querySelector('strong').textContent,'07:50');assert.match(find('localBusNextTitle').textContent,/Первые рейсы/);
 assert.equal(find('localBusTrip').options.length,13);assert.equal(find('localBusTrip').options[12].value,'1170');
 choose('localBusDay','weekend');assert.equal(find('localBusTrip').options.length,8);assert.equal(find('localBusTrip').options[7].textContent,'14:30 — 15:00');
 choose('localBusStop','terekhovka');choose('localBusDirection','outbound');assert.equal(find('localBusStop').value,'college');
 assert.match(find('localBusEnd').textContent,/15:00/);assert.equal(find('localBusTrip').options[7].textContent,'14:00 — 14:30');
 find('btnRouteGlub').click();assert.equal(find('routeGlubContent').hidden,false);assert.equal(find('routeLocalContent').hidden,true);
 find('btnRouteGlub').dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Home',bubbles:true}));assert.equal(find('btnRouteLocal').getAttribute('aria-selected'),'true');
 find('btnRouteUka').click();assert.equal(find('routeUkaContent').textContent,beforeUka);assert.equal(find('routeGlubContent').textContent,beforeGlub);
 choose('localBusDay','today');choose('localBusStop','school1');date=new Date('2026-09-27T18:59:00Z');app.refresh();assert.match(find('localBusNext').textContent,/больше нет/);
 date=new Date('2026-09-27T19:00:00Z');app.refresh();assert.equal(find('localBusTrip').options.length,14);assert.equal(find('localBusNext').querySelector('strong').textContent,'07:10');
 console.log('PASS: local bus tabs, stop times, last trips, weekday/holiday preview, midnight, keyboard and existing regional timetables');
} finally {app.destroy();dom.window.close();}
