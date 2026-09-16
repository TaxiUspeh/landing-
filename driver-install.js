// Installation is optional and never requests notification permission.
(() => {
    const $ = id => document.getElementById(id);
    const offer = $('driver-install-offer');
    const button = $('driver-install-app-button');
    const message = $('driver-install-app-message');
    const standalone = window.matchMedia('(display-mode: standalone)');
    const dismissKey = 'driver-install-dismissed-until';
    let deferredPrompt = null, installed = false, busy = false, dismissedUntil = 0;
    try { dismissedUntil = Number(localStorage.getItem(dismissKey)) || 0; } catch { /* Private browser storage may be unavailable. */ }
    function isInstalled() { return installed || standalone.matches || navigator.standalone === true; }
    function update() {
        const done = isInstalled();
        if (offer) offer.hidden = done || dismissedUntil > Date.now();
        if (button) { button.classList.toggle('hidden', done); button.disabled = busy; }
    }
    function show(text) {
        if (!message) return;
        message.textContent = text; message.classList.remove('hidden');
    }
    function instructions() {
        const ios = /iPad|iPhone|iPod/.test(navigator.userAgent)
            || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        show(ios
            ? 'В Safari нажмите «Поделиться» → «На экран Домой». Затем откройте приложение с новой иконки.'
            : 'Откройте меню браузера ⋮ → «Установить приложение» или «Добавить на главный экран». Если этого пункта нет, откройте ссылку в Chrome или Edge.');
    }
    window.addEventListener('beforeinstallprompt', event => {
        event.preventDefault(); deferredPrompt = event; update();
    });
    button?.addEventListener('click', async () => {
        if (busy || isInstalled()) return;
        if (!deferredPrompt) { instructions(); return; }
        // Each native event can be used only once, including when dismissed.
        const prompt = deferredPrompt; deferredPrompt = null; busy = true; update();
        try {
            await prompt.prompt();
            const choice = await prompt.userChoice;
            show(choice.outcome === 'accepted'
                ? 'Приложение устанавливается. Откройте его с иконки на телефоне.'
                : 'Установку можно повторить позже из профиля или меню браузера.');
        } catch { instructions(); }
        finally { busy = false; update(); }
    });
    $('driver-install-later')?.addEventListener('click', () => {
        dismissedUntil = Date.now() + 7 * 24 * 60 * 60 * 1000;
        try { localStorage.setItem(dismissKey, String(dismissedUntil)); } catch { /* Keep the choice for this visit. */ }
        update();
    });
    window.addEventListener('appinstalled', () => {
        installed = true; deferredPrompt = null; update();
        show('Приложение установлено. Открывайте его с иконки на телефоне.');
    });
    standalone.addEventListener?.('change', update);
    window.addEventListener('pageshow', update);
    $('driver-conditions-link')?.addEventListener('click', () => { $('driver-conditions').open = true; });
    update();
})();
