import {
    collection,
    doc,
    onSnapshot,
    query,
    where,
    serverTimestamp,
    updateDoc
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const CATEGORY_LABELS = {
    'Куплю / продам': 'Товары',
    'Услуги': 'Услуги',
    'Недвижимость': 'Недвижимость',
    'Работа': 'Работа',
    'Транспорт': 'Транспорт',
    'Местный бизнес': 'Местный бизнес'
};
const TYPE_LABELS = { offer_product: 'Продажа вещи', offer_service: 'Предложение услуги', seek_product: 'Покупка вещи', seek_service: 'Поиск специалиста' };
const PRICE_MODE_LABELS = { fixed: 'Цена', from: 'Цена от', hour: 'За час', negotiable: 'По договорённости', budget: 'Бюджет', offer: 'Предлагайте цену', free: 'Бесплатно' };

function textElement(tag, className, value) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    element.textContent = value == null ? '' : String(value);
    return element;
}

function formatDate(value) {
    const date = value?.toDate ? value.toDate() : value?.seconds ? new Date(value.seconds * 1000) : null;
    if (!date || Number.isNaN(date.getTime())) return 'Дата не указана';
    return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
}

export function initClassifiedModeration(db, user) {
    const list = document.getElementById('classified-moderation-list');
    const count = document.getElementById('classified-moderation-count');
    const message = document.getElementById('classified-moderation-message');
    if (!list || !count || !message || !user?.uid) return () => {};

    let busy = false;
    const setMessage = (value, isError = false) => {
        message.textContent = value;
        message.classList.toggle('hidden', !value);
        message.classList.toggle('text-red-700', isError);
        message.classList.toggle('bg-red-50', isError);
        message.classList.toggle('text-slate-600', !isError);
        message.classList.toggle('bg-slate-50', !isError);
    };

    const unsubscribe = onSnapshot(query(collection(db, 'classifiedListings'), where('status', '==', 'pending')), (snapshot) => {
        const pending = snapshot.docs
            .map((item) => ({ id: item.id, ...item.data() }))
            .filter((item) => item.status === 'pending')
            .sort((a, b) => {
                const aTime = a.createdAt?.toMillis?.() || 0;
                const bTime = b.createdAt?.toMillis?.() || 0;
                return bTime - aTime;
            });

        count.textContent = String(pending.length);
        list.replaceChildren();

        if (!pending.length) {
            list.append(textElement('p', 'rounded-xl bg-slate-50 p-4 text-sm text-slate-600 dark:bg-slate-950/60 dark:text-slate-300', 'Новых объявлений на проверке нет.'));
            return;
        }

        for (const item of pending) {
            const card = textElement('article', 'rounded-xl border border-slate-200 p-4 dark:border-slate-700');
            const top = textElement('div', 'flex flex-wrap items-start justify-between gap-2');
            const title = textElement('h3', 'font-extrabold text-slate-900 dark:text-slate-100', item.title || 'Без названия');
            const date = textElement('span', 'text-xs text-slate-500 dark:text-slate-400', formatDate(item.createdAt));
            top.append(title, date);
            card.append(top);

            const inferredType = item.listingType || (item.category === 'Услуги' ? 'offer_service' : /^куплю\b/i.test(item.title || '') ? 'seek_product' : 'offer_product');
            const meta = [TYPE_LABELS[inferredType] || 'Объявление', CATEGORY_LABELS[item.category] || item.category || 'Без категории', item.location || 'Место не указано'];
            card.append(textElement('p', 'mt-1 text-sm font-semibold text-blue-700 dark:text-blue-300', meta.join(' · ')));
            if (item.description) card.append(textElement('p', 'mt-2 whitespace-pre-wrap break-words text-sm text-slate-700 dark:text-slate-300', item.description));
            const details = [];
            const priceMode = item.priceMode || 'fixed';
            const priceLabel = PRICE_MODE_LABELS[priceMode] || 'Цена';
            if (item.price !== null && item.price !== undefined && item.price !== '') details.push(priceLabel + ': ' + Number(item.price).toLocaleString('ru-RU') + ' ₸');
            else if (['negotiable','offer','free'].includes(priceMode)) details.push(priceLabel);
            if (item.phone) details.push('Телефон: ' + item.phone);
            if (item.ownerName) details.push('Автор: ' + item.ownerName);
            if (details.length) card.append(textElement('p', 'mt-2 break-words text-xs text-slate-500 dark:text-slate-400', details.join(' · ')));

            const actions = textElement('div', 'mt-3 flex flex-wrap gap-2');
            const approve = textElement('button', 'rounded-xl bg-green-600 px-4 py-2 text-sm font-extrabold text-white hover:bg-green-700 disabled:opacity-50', 'Одобрить');
            approve.type = 'button';
            approve.dataset.classifiedReview = 'approved';
            approve.dataset.listingId = item.id;
            const reject = textElement('button', 'rounded-xl bg-red-600 px-4 py-2 text-sm font-extrabold text-white hover:bg-red-700 disabled:opacity-50', 'Отклонить');
            reject.type = 'button';
            reject.dataset.classifiedReview = 'rejected';
            reject.dataset.listingId = item.id;
            actions.append(approve, reject);
            card.append(actions);
            list.append(card);
        }
    }, (error) => {
        console.error('Не удалось загрузить объявления для модерации:', error.code || error.message);
        setMessage('Не удалось загрузить объявления. Проверьте подключение и права доступа.', true);
    });

    const handleClick = async (event) => {
        const button = event.target.closest('button[data-classified-review][data-listing-id]');
        if (!button || busy) return;
        const status = button.dataset.classifiedReview;
        const id = button.dataset.listingId;
        if (!['approved', 'rejected'].includes(status) || !id) return;
        busy = true;
        list.querySelectorAll('button').forEach((item) => { item.disabled = true; });
        setMessage(status === 'approved' ? 'Одобряем объявление…' : 'Отклоняем объявление…');
        try {
            await updateDoc(doc(db, 'classifiedListings', id), {
                status,
                moderatedAt: serverTimestamp(),
                moderatedBy: user.uid,
                updatedAt: serverTimestamp()
            });
            setMessage(status === 'approved' ? 'Объявление опубликовано.' : 'Объявление отклонено.');
        } catch (error) {
            console.error('Не удалось изменить статус объявления:', error.code || error.message);
            setMessage(error.code === 'permission-denied'
                ? 'Firebase отказал в доступе. Проверьте права администратора и правила Firestore.'
                : 'Не удалось сохранить решение. Попробуйте ещё раз.', true);
        } finally {
            busy = false;
            list.querySelectorAll('button').forEach((item) => { item.disabled = false; });
        }
    };
    list.addEventListener('click', handleClick);

    return () => {
        unsubscribe();
        list.removeEventListener('click', handleClick);
        list.replaceChildren();
        count.textContent = '0';
        setMessage('');
    };
}
