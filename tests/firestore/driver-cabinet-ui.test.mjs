import { normalizeCity } from '../../booking-core.js';
import { priceDescription } from '../../customer-pricing.js';
import { orderTimeInfo } from '../../order-time.js';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { initDriverCabinet } from '../../driver-cabinet.js';
import * as finance from '../../driver-finance.js';
import * as categories from '../../vehicle-categories.js';
import * as auction from '../../auction-core.js';

const html = await readFile(new URL('../../drivers.html', import.meta.url), 'utf8');
const source = await readFile(new URL('../../driver-portal.js', import.meta.url), 'utf8');
const dom = new JSDOM(html, { url:'https://example.test/drivers.html', pretendToBeVisual:true });
globalThis.document = dom.window.document; globalThis.window = dom.window;
dom.window.HTMLElement.prototype.scrollIntoView = function() {};
const get = id => document.getElementById(id);
const original = Object.fromEntries(['driver-logout-button','driver-dispatcher-chat-form','driver-mobile-share','driver-install-app-button'].map(id=>[id,get(id)]));
const events = [];
let authListener;
const context = vm.createContext({
    ...finance, ...categories, ...auction, initDriverCabinet, orderTimeInfo, normalizeCity, priceDescription,
    document, window, navigator:window.navigator, localStorage:window.localStorage,
    URLSearchParams, console, setTimeout:()=>1, clearTimeout:()=>{}, setInterval:()=>1, clearInterval:()=>{},
    requestAnimationFrame:callback=>callback(), auth:{}, db:{}, googleProvider:{},
    getRedirectResult:async()=>null, onAuthStateChanged:(_auth,fn)=>{authListener=fn;},
    getDoc:async()=>({exists:()=>true,data:()=>({customerName:'Клиент',customerPhone:'+77000000000'})}),
    doc:(_db,...path)=>path.join('/'), onSnapshot:()=>()=>{}, events
});
vm.runInContext(source.replace(/^import[\s\S]*?;\n/gm,''),context);
const run = code=>vm.runInContext(code,context);
assert.equal(get('driver-cabinet-nav').hidden,true);
run(`currentUser={uid:'test-driver'};currentDriverId='666';currentAccount={active:true,driverId:'666'};
currentDriver={name:'Водитель',driverNumber:666,status:'active',balance:-4380,commissionRate:20,debtMode:'limited',debtLimit:1000,serviceCategories:['sedan'],passengerSeats:4};
currentBaseEligible=true;currentCanTakeOrders=true;currentDriverState={status:'available',exists:true};assignedOrdersLoaded=true;openOrdersLoaded=true;
setHidden(elements.profile,false);setHidden(elements.signedIn,false);updateMobilePrimaryAction();
openOrders=Array.from({length:10},(_,i)=>({id:'order-'+i,orderNumber:'TU-'+i,status:'searching',serviceType:'taxi',vehicleCategory:'sedan',passengerCount:1,from:'Жукова 20',to:'Карла Маркса 76',priceAmount:1000,priceText:'1 000 ₸'}));renderOnlineOrders();renderWorkStatus(currentDriver,currentAccount);`);
assert.equal(document.body.classList.contains('driver-cabinet-ready'),true);
assert.equal(get('driver-cabinet-nav').hidden,false);
assert.equal(get('driver-online-orders-list').children.length,10);
assert.match(document.querySelector('[data-order-filter="new"]').textContent,/10/);
assert.ok([...document.querySelectorAll('.cabinet-order-disclosure')].every(el=>!el.open));
assert.equal(get('driver-view-orders').hidden,false);
for(const [id,node] of Object.entries(original)) assert.equal(get(id),node,`${id} keeps listeners`);
// Compact display retains stops, original navigation and the full price explanation.
run(`var compactExample = { ...openOrders[0], fromAddress:'улица Школьная (Kojohovo)',
toAddress:'Perevalnoe (Perevalnoe)', stops:['Магазин (Belousovka)'],
pricingType:'calculated', calculatedPrice:2184, customerOfferPrice:null, routeDistanceMeters:9500,
priceAmount:2184, priceText:'2 184 ₸' };
var compactCard = createOrderCard(compactExample,false);`);
const compactCard=run('compactCard');
assert.deepEqual([...compactCard.querySelectorAll('.cabinet-route-label')].map(el=>el.textContent),['Откуда','Через 1','Куда']);
assert.deepEqual([...compactCard.querySelectorAll('.cabinet-route-address')].map(el=>el.textContent),['улица Школьная (Kojohovo)','Магазин (Белоусовка)','Perevalnoe']);
assert.equal(run('compactExample.toAddress'),'Perevalnoe (Perevalnoe)');
assert.match(decodeURIComponent(compactCard.querySelector('a').href),/Школьная \(Kojohovo\)~Магазин \(Belousovka\)~Perevalnoe \(Perevalnoe\)/);
assert.equal(compactCard.querySelector('.cabinet-order-distance').textContent,'Поездка: 9,5 км');
assert.equal(compactCard.querySelector('.cabinet-order-commission').closest('details'),null);
assert.equal(compactCard.querySelector('.cabinet-price-details').closest('details').open,false);
assert.match(compactCard.querySelector('.cabinet-price-details').textContent,/Расчётная цена/);
const increased=run('createOrderCard({...compactExample,customerOfferPrice:2500,priceAmount:2500,priceText:"2 500 ₸",previousPrice:2184,priceRevision:1},false)');
assert.equal(increased.querySelector('.cabinet-price-note').textContent,'Цена повышена');
assert.match(increased.querySelector('.cabinet-price-details').textContent,/Цена повышена:/);
// Minute refresh preserves card order, action controls, focus and open details.
run(`const creation = Date.parse('2026-09-20T05:42:00Z');
openOrders.forEach((order,i)=>{order.createdAt={toMillis:()=>creation+i*60000};});
openOrders[0].scheduledFor='2026-09-20T15:00';renderOnlineOrders();`);
const timedCard=get('driver-online-orders-list').firstElementChild;
const createdLine=timedCard.querySelector('[data-order-created-time]');
const scheduledLine=timedCard.querySelector('[data-order-scheduled-time]');
assert.equal(createdLine.closest('details'),null);assert.equal(scheduledLine.closest('details'),null);
const disclosure=timedCard.querySelector('details');disclosure.open=true;
const accept=timedCard.querySelector('[data-order-control="accept"]');accept.focus();
const orderedCards=[...get('driver-online-orders-list').children];
run("updateVisibleOrderTimes(Date.parse('2026-09-20T05:47:00Z'))");
assert.match(createdLine.textContent,/10:42 · 5 мин назад/);assert.equal(scheduledLine.textContent,'Подача сегодня в 15:00');
run("updateVisibleOrderTimes(Date.parse('2026-09-20T05:48:00Z'))");
assert.match(createdLine.textContent,/6 мин назад/);assert.equal(disclosure.open,true);assert.equal(document.activeElement,accept);
assert.deepEqual([...get('driver-online-orders-list').children],orderedCards);
assert.equal(orderedCards[0].dataset.orderId,'order-0');assert.equal(orderedCards.at(-1).dataset.orderId,'order-9');
get('driver-wallet-summary').click();
assert.equal(get('driver-view-balance').hidden,false);
assert.equal(get('driver-view-orders').hidden,true);
assert.match(get('driver-finance-summary').textContent,/5\s*380/);
assert.equal(get('driver-finance-summary').querySelectorAll('dt').length,4);
assert.equal(get('driver-finance-summary').textContent.includes('На счёте'),false);
get('driver-dispatcher-chat-input').value='Нужна помощь';
document.querySelector('[data-cabinet-view="chat"]').click();
assert.equal(get('driver-view-chat').hidden,false);
assert.equal(get('driver-dispatcher-chat-content').classList.contains('hidden'),false);
run('signalDispatcherChatReply()');
assert.equal(document.querySelector('.cabinet-unread').hidden,false);
document.querySelector('[data-cabinet-view="chat"]').click();
assert.equal(document.querySelector('.cabinet-unread').hidden,true);
assert.equal(get('driver-dispatcher-chat-input').value,'Нужна помощь');
document.querySelector('[data-cabinet-view="orders"]').click();
const first = get('driver-order-order-0'); first.querySelector('details').open=true;
run('renderOnlineOrders()');
assert.equal(get('driver-order-order-0').querySelector('details').open,true);
run(`acceptOrder=id=>events.push(['accept',id]);advanceOrder=(...args)=>events.push(['advance',...args]);returnOrderToSearch=(...args)=>events.push(['requeue',...args]);`);
get('driver-order-order-0').querySelector('[data-order-control="accept"]').click();
assert.deepEqual(Array.from(events.pop()),['accept','order-0']);
run(`assignedOrders=[{...openOrders[0],status:'accepted',assignedDriverUid:'test-driver',commissionTerms:{rate:20,baseAmount:1000,amount:200}}];currentCanTakeOrders=false;currentDriverState.status='busy';renderOnlineOrders();`);
assert.equal(get('driver-view-orders').hidden,false);
assert.match(document.querySelector('[data-order-filter="current"]').textContent,/1/);
assert.equal(get('driver-order-order-0').querySelector('details').open,true);
assert.match(get('driver-finance-summary').textContent,/5\s*180/);
let primary = get('driver-order-order-0').querySelector('[data-order-control="advance"]');
assert.equal(primary.closest('details'),null);
assert.equal(primary.textContent,'Я подъехал');primary.click();assert.deepEqual(Array.from(events.pop()),['advance','order-0','accepted','arrived']);
const cancel = get('driver-order-order-0').querySelector('.cabinet-cancel');cancel.open=true;cancel.querySelector('select').value='cannot_continue';
run('renderOnlineOrders()');
assert.equal(get('driver-order-order-0').querySelector('.cabinet-cancel').open,true);
get('driver-order-order-0').querySelector('[data-order-control="requeue"]').click();
assert.deepEqual(Array.from(events.pop()),['requeue','order-0','accepted','cannot_continue']);
run("assignedOrders[0].status='arrived';renderOnlineOrders()");
primary=get('driver-order-order-0').querySelector('[data-order-control="advance"]');assert.equal(primary.textContent,'Завершить заказ');
primary.click();assert.deepEqual(Array.from(events.pop()),['advance','order-0','arrived','completed']);
run("assignedOrders[0].cancellationRequestStatus='pending';renderOnlineOrders()");
assert.equal(get('driver-order-order-0').querySelector('[data-order-control="advance"]'),null);
assert.equal(get('driver-order-order-0').querySelector('[data-order-control="requeue"]'),null);
run("assignedOrders[0].status='completed';assignedOrders[0].commissionAmount=200;renderOnlineOrders()");
assert.equal(run('ordersTab'),'new');
document.querySelector('[data-order-filter="history"]').click();
assert.equal(get('driver-online-orders-list').children.length,1);
assert.equal(get('driver-order-order-0').querySelector('button'),null,'archived trips cannot be accepted/completed again');
assert.match(get('driver-order-order-0').textContent,/Списанная комиссия/);
// Realtime updates keep an auction draft and focus, including while typing.
run(`assignedOrders=[];currentCanTakeOrders=true;currentDriverState.status='available';ordersTab='new';
auctionOrders=[{...openOrders[0],id:'bid',status:'bidding',auctionRound:1,proposedPrice:3000,priceAmount:3000}];renderOnlineOrders();`);
get('driver-order-bid').querySelector('details').open=true;
const offerPrice=get('driver-order-bid').querySelector('[data-order-control="offer-price"]');
offerPrice.value='3600';offerPrice.dispatchEvent(new window.Event('input'));offerPrice.focus();
run('renderOnlineOrders()');
assert.equal(get('driver-order-bid').querySelector('[data-order-control="offer-price"]').value,'3600');
assert.equal(document.activeElement.dataset.orderControl,'offer-price');
assert.equal(get('driver-order-bid').querySelector('details').open,true);
run(`currentDriver.balance=100;currentDriver.debtMode='none';currentDriver.debtLimit=0;renderOnlineOrders();renderWorkStatus(currentDriver,currentAccount);`);
assert.equal(get('driver-order-order-0').querySelector('[data-order-control="accept"]').disabled,true);
assert.equal(get('driver-work-status-card').dataset.brief,'false');
assert.match(get('driver-work-status-detail').textContent,/Пополните баланс/);

// Presentation keeps finance meaning and exposes the main actions without disclosure.
assert.equal(document.querySelectorAll('#driver-cabinet-nav button').length, 4);
assert.equal(get('driver-order-order-0').querySelector('[data-order-control="accept"]').closest('details'), null);
document.querySelector('[data-cabinet-view="profile"]').click();
assert.equal(get('driver-view-profile').hidden, false);
assert.equal(get('driver-wallet-summary').hidden, true);
assert.equal(get('driver-work-status-card').hidden, true);
assert.ok(get('driver-profile-car').closest('#driver-view-profile'));
assert.ok(get('driver-orders-link').closest('#driver-view-chat'));
assert.equal(get('driver-view-profile').lastElementChild, get('driver-logout-button'));
run("currentDriver.commissionRate=0; currentDriver.balance=-2400; renderOnlineOrders();");
assert.match(document.querySelector('.cabinet-balance-value').textContent, /На счёте: 2\s*400/);
assert.match(get('driver-commission-short').textContent, /0%/);
run("currentDriver.balance=220; renderOnlineOrders();");
assert.match(document.querySelector('.cabinet-balance-value').textContent, /Долг: 220/);

// Period filters constrain the server query and discard stale pages / live callbacks.
run(`var historySubscriptions=[];var historyResolvers=[];
where=(...args)=>['where',...args];orderBy=(...args)=>['orderBy',...args];limit=(...args)=>['limit',...args];
startAfter=(...args)=>['startAfter',...args];collection=(_db,path)=>path;query=(...args)=>args;
onSnapshot=(query,success,error)=>{historySubscriptions.push({query,success,error});return ()=>{};};
getDocs=()=>new Promise(resolve=>historyResolvers.push(resolve));
balanceHistoryExpanded=true;changeBalanceHistoryPeriod('today');`);
assert.equal(run("historySubscriptions.at(-1).query.some(c=>c[0]==='where' && c[1]==='changedAt' && c[2]==='>=')"), true);
assert.equal(run('balanceHistoryPeriodStart.getHours()'), 0);
run(`balanceHistoryCursor={id:'cursor'};balanceHistoryHasMore=true;var oldPage=loadMoreBalanceHistory();`);
document.querySelector('[data-history-period="week"]').click();
assert.equal(run('balanceHistoryPeriod'), 'week');
assert.equal(run("historySubscriptions.at(-1).query.some(c=>c[0]==='startAfter')"), false);
run(`historySubscriptions[0].success({docs:[{id:'stale',data:()=>({reason:'old'})}]});historyResolvers[0]({docs:[{id:'late',data:()=>({reason:'old page'})}]});`);
await run('oldPage');
assert.equal(run('balanceHistory.length'),0);
document.querySelector('[data-history-period="all"]').click();
assert.equal(run("historySubscriptions.at(-1).query.some(c=>c[0]==='where' && c[1]==='changedAt')"), false);
run(`historySubscriptions.at(-1).success({docs:[{id:'current',data:()=>({reason:'Пополнение',difference:-500,changedAt:{toMillis:()=>Date.now(),toDate:()=>new Date()}})}]});`);
assert.match(get('driver-balance-history-list').textContent,/Пополнение/);

// Switching identities restores registration controls and public content.
window.location.hash = '#driver-order-alerts';
run('cabinet.setEnabled(false); updateMobilePrimaryAction();');
assert.equal(get('driver-view-profile').hidden, false, 'test push links open the notification settings');
const publicInfo=document.querySelector('.cabinet-public-info');assert.ok(publicInfo.children.length>1);
authListener(null);
assert.equal(document.body.classList.contains('driver-cabinet-ready'),false);
assert.equal(get('driver-cabinet-nav').hidden,true);
assert.equal(publicInfo.children.length,1);
assert.ok(get('driver-mobile-share').closest('.cabinet-legacy-bar'));
assert.ok(get('driver-install-app-button').closest('#driver-install-offer'));
assert.ok(get('driver-user-name').closest('#driver-signed-in'));
await Promise.resolve();
dom.window.close();
console.log('PASS: 10 orders, preserved handlers, navigation, finance, chat, active steps, cancellation, history and sign-out');
