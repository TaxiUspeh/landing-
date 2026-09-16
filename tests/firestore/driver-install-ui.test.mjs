import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
const html = await readFile(new URL('../../drivers.html', import.meta.url), 'utf8');
const source = await readFile(new URL('../../driver-install.js', import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture({ installed = false, dismiss = 0, blocked = false, ua = '' } = {}) {
    const dom = new JSDOM(html, { url: 'https://example.test/drivers.html' });
    const w = dom.window;
    w.matchMedia = () => ({ matches: installed, addEventListener() {} });
    if (ua) Object.defineProperty(w.navigator, 'userAgent', { value: ua });
    if (dismiss) w.localStorage.setItem('driver-install-dismissed-until', String(dismiss));
    const storage = blocked ? {getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}} : w.localStorage;
    vm.runInContext(source, vm.createContext({ document:w.document, window:w, navigator:w.navigator, localStorage:storage, Date }));
    const get = id => w.document.getElementById(id);
    return {dom,w,get};
}
{
    const {dom,w,get} = fixture(); let prompts = 0;
    assert.equal(get('driver-install-offer').hidden, false);
    const event = new w.Event('beforeinstallprompt', {cancelable:true});
    event.prompt = async () => { prompts++; };
    event.userChoice = Promise.resolve({outcome:'dismissed'});
    w.dispatchEvent(event);
    assert.equal(event.defaultPrevented,true); assert.equal(prompts,0,'no automatic prompt');
    get('driver-install-app-button').click(); get('driver-install-app-button').click();
    await tick(); assert.equal(prompts,1,'one native prompt per event');
    get('driver-install-app-button').click(); await tick();
    assert.equal(prompts,1); assert.match(get('driver-install-app-message').textContent,/меню браузера/);
    get('driver-install-later').click();
    assert.equal(get('driver-install-offer').hidden,true);
    assert.ok(Number(w.localStorage.getItem('driver-install-dismissed-until')) > Date.now()+6*86400000);
    // The same control moves to the profile; dismissal only hides the guest offer.
    assert.equal(get('driver-install-app-button').classList.contains('hidden'),false);
    w.dispatchEvent(new w.Event('appinstalled'));
    assert.equal(get('driver-install-app-button').classList.contains('hidden'),true,'appinstalled hides even in a normal browser tab');
    dom.window.close();
}
for (const opts of [{installed:true},{dismiss:Date.now()+100000}]) {
    const {dom,get}=fixture(opts);assert.equal(get('driver-install-offer').hidden,true);dom.window.close();
}
{
    const {dom,get}=fixture({dismiss:Date.now()-1000,ua:'iPhone Safari'});
    assert.equal(get('driver-install-offer').hidden,false);
    get('driver-install-app-button').click();assert.match(get('driver-install-app-message').textContent,/Safari.*Поделиться.*На экран Домой/);
    get('driver-conditions-link').click();assert.equal(get('driver-conditions').open,true);
    dom.window.close();
}
{
    const {dom,get}=fixture({blocked:true});get('driver-install-later').click();assert.equal(get('driver-install-offer').hidden,true);dom.window.close();
}
console.log('PASS: installation gesture, single-use event, 7-day dismissal, standalone, installed event, iOS and blocked storage');
