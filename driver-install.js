// Installation is optional and never requests notification permission.
(() => {
    const $ = id => document.getElementById(id);
    const offer = $('driver-install-offer');
    const button = $('driver-install-app-button');
    const message = $('driver-install-app-message');
    const help = $('driver-install-help');
    const standalone = window.matchMedia('(display-mode: standalone)');
    let deferredPrompt = null, installed = false, busy = false;

    function isInstalled() {
        return installed || standalone.matches || navigator.standalone === true;
    }
    function update() {
        if (offer) offer.hidden = isInstalled();
        if (button) {
            button.classList.toggle('hidden', isInstalled());
            button.disabled = busy;
        }
    }
    function show(text) {
        if (!message) return;
        message.textContent = text;
        message.classList.remove('hidden');
    }
    function instructions() {
        const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
            (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        show(ios
            ? 'На iPhone откройте страницу в Safari, нажмите «Поделиться», затем «На экран Домой» и подтвердите добавление.'
            : 'Откройте меню браузера (⋮) и выберите «Установить приложение» или «Добавить на главный экран». Если пункта нет, откройте страницу в Chrome.');
        if (help) {
            help.hidden = false;
            help.open = true;
            help.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }
    window.addEventListener('beforeinstallprompt', event => {
        event.preventDefault();
        deferredPrompt = event;
    });
    button?.addEventListener('click', async () => {
        if (busy || isInstalled()) return;
        if (!deferredPrompt) {
            instructions();
            return;
        }
        const prompt = deferredPrompt;
        deferredPrompt = null;
        busy = true;
        update();
        try {
            await prompt.prompt();
            const choice = await prompt.userChoice;
            if (choice.outcome === 'accepted') {
                show('Запрос на установку принят. Дождитесь завершения установки и откройте кабинет с иконки телефона.');
            } else {
                instructions();
            }
        } catch {
            instructions();
        } finally {
            busy = false;
            update();
        }
    });
    window.addEventListener('appinstalled', () => {
        installed = true;
        deferredPrompt = null;
        update();
        show('Приложение установлено. Открывайте кабинет с иконки на телефоне.');
    });
    standalone.addEventListener?.('change', update);
    window.addEventListener('pageshow', update);
    $('driver-conditions-link')?.addEventListener('click', () => {
        const conditions = $('driver-conditions');
        if (conditions) conditions.open = true;
    });
    update();
})();
