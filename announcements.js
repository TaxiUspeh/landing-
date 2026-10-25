import { auth, db, googleProvider } from './firebase-config.js';
import { onAuthStateChanged, signInWithPopup } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { collection, addDoc, getDocs, getDoc, doc, query, where, Timestamp, updateDoc, limit, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const $ = (id) => document.getElementById(id);
const listingsCol = collection(db, 'classifiedListings');
const dialog = $('listingDialog');
const form = $('listingForm');
let currentUser = null;
let isAdmin = false;
let activeCategory = 'all';
let activeType = 'all';
let allListings = [];
const categories = ['Куплю / продам', 'Услуги', 'Недвижимость', 'Работа', 'Транспорт', 'Местный бизнес'];
const typeLabels = {offer_product:'Продажа',offer_service:'Услуга',seek_product:'Покупка',seek_service:'Поиск специалиста'};
function inferType(item) {
  if (['offer_product','offer_service','seek_product','seek_service'].includes(item.listingType)) return item.listingType;
  if (item.category === 'Услуги') return 'offer_service';
  if (item.category === 'Куплю / продам' && /^куплю\b/i.test(item.title || '')) return 'seek_product';
  return item.category === 'Куплю / продам' ? 'offer_product' : 'offer_service';
}
function priceText(item) {
  const hasPrice = item.price !== null && item.price !== undefined && item.price !== '';
  const amount = hasPrice ? Number(item.price).toLocaleString('ru-RU') + ' ₸' : '';
  if (item.priceMode === 'from') return hasPrice ? 'От ' + amount : 'Цена от…';
  if (item.priceMode === 'hour') return hasPrice ? amount + ' / час' : 'Оплата за час';
  if (item.priceMode === 'negotiable') return 'По договорённости';
  if (item.priceMode === 'budget') return hasPrice ? 'Бюджет: ' + amount : 'Обсудим бюджет';
  if (item.priceMode === 'offer') return 'Предлагайте цену';
  if (item.priceMode === 'free') return inferType(item).startsWith('seek_') ? 'Без бюджета' : 'Бесплатно';
  return hasPrice ? amount : (inferType(item).startsWith('seek_') ? 'Предлагайте варианты' : 'Цена договорная');
}
const safeText = (value = '') => String(value).replace(/[&<>"']/g, (ch) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const phoneHref = (phone) => 'tel:' + String(phone || '').replace(/[^+0-9]/g, '');
const formatDate = (date) => date ? new Intl.DateTimeFormat('ru-RU', {day:'numeric',month:'short'}).format(date) : '';
const toDate = (value) => value && typeof value.toDate === 'function' ? value.toDate() : null;
function showNotice(message, error = false) { $('notice').textContent = message; $('notice').style.color = error ? '#a32d25' : ''; }
function categoryIcon(category) { return ({'Куплю / продам':'🛍️','Услуги':'🧰','Недвижимость':'🏠','Работа':'💼','Транспорт':'🚗','Местный бизнес':'🏪'})[category] || '📣'; }

function renderCards() {
  const term = $('searchInput').value.trim().toLocaleLowerCase('ru-RU');
  const filtered = allListings.filter(item => (activeCategory === 'all' || item.category === activeCategory)
    && (activeType === 'all' || inferType(item) === activeType)
    && (!term || [item.title,item.description,item.location,item.category,item.subcategory].join(' ').toLocaleLowerCase('ru-RU').includes(term)));
  $('listingCount').textContent = filtered.length + ' объявл.';
  if (!filtered.length) {
    $('listingGrid').innerHTML = '<div class="empty">Пока нет опубликованных объявлений. Новые объявления появятся здесь после проверки модератором.</div>';
    return;
  }
  $('listingGrid').innerHTML = filtered.map(item => {
    const image = item.imageUrl && /^https:\/\//i.test(item.imageUrl) ? '<img class="listing-photo" loading="lazy" src="' + safeText(item.imageUrl) + '" alt="" referrerpolicy="no-referrer">' : '<div class="listing-photo-placeholder" aria-hidden="true">' + categoryIcon(item.category) + '</div>';
    const type = inferType(item);
    const price = '<div class="price">' + safeText(priceText(item)) + '</div>';
    return '<article class="listing-card">' + image + '<div class="listing-body"><span class="tag">' + safeText(typeLabels[type] || item.category) + ' · ' + safeText(item.category) + '</span><h3>' + safeText(item.title) + '</h3>' + price + '<div class="description">' + safeText(item.description) + '</div><div class="meta"><span>📍 ' + safeText(item.location) + '</span><span>' + formatDate(toDate(item.createdAt)) + '</span></div><a class="contact" href="' + safeText(phoneHref(item.phone)) + '">Позвонить автору</a></div></article>';
  }).join('');
}
async function loadListings() {
  $('listingGrid').innerHTML = '<div class="loading">Загружаем объявления…</div>';
  try {
    const now = Timestamp.now();
    const snap = await getDocs(query(listingsCol, where('status','==','approved'), where('expiresAt','>',now), limit(100)));
    allListings = snap.docs.map(d => ({id:d.id,...d.data()})).sort((a,b) => (toDate(b.createdAt)?.getTime() || 0) - (toDate(a.createdAt)?.getTime() || 0));
    renderCards();
  } catch (error) {
    console.error('Ошибка загрузки объявлений:', error);
    $('listingGrid').innerHTML = '<div class="empty">Не удалось загрузить объявления. Код ошибки: ' + safeText(error.code || error.name || 'unknown') + '. Обновите страницу и попробуйте ещё раз.</div>';
  }
}
async function ensureSignIn() {
  if (auth.currentUser) return auth.currentUser;
  try { await signInWithPopup(auth, googleProvider); return auth.currentUser; }
  catch (error) {
    if (error.code === 'auth/popup-blocked' || error.code === 'auth/cancelled-popup-request') {
      throw new Error('Не удалось открыть окно входа. Разрешите всплывающие окна и повторите попытку.');
    }
    throw new Error('Для размещения объявления нужно войти через Google. ' + (error.code || 'Вход не завершён.'));
  }
}
async function checkAdmin(user) {
  if (!user) return false;
  try { const snap = await getDoc(doc(db,'admins',user.uid)); return snap.exists() && snap.data().active === true; }
  catch { return false; }
}
function renderMine(items) {
  $('myListings').innerHTML = items.length ? items.map(item => {
    const expired = item.status === 'approved' && toDate(item.expiresAt) && toDate(item.expiresAt).getTime() <= Date.now();
    const label = expired ? 'Срок истёк — скрыто из каталога' : item.statusLabel;
    const type = inferType(item);
    const action = type === 'offer_product' ? 'Отметить проданным' : type === 'offer_service' ? 'Снять с публикации' : 'Закрыть поиск';
    const nextStatus = type === 'offer_product' ? 'sold' : type === 'offer_service' ? 'service_inactive' : 'search_closed';
    return '<div class="mine-row"><div><strong>' + safeText(item.title) + '</strong><p>' + safeText(label) + ' · ' + safeText(typeLabels[type] || item.category) + (item.expiresAt ? ' · до ' + formatDate(toDate(item.expiresAt)) : '') + '</p></div>' + (item.status === 'approved' && !expired ? '<button class="small-btn" data-close-listing="' + safeText(item.id) + '" data-next-status="' + nextStatus + '" type="button">' + action + '</button>' : '') + '</div>';
  }).join('') : '<div class="empty">Вы пока не размещали объявления.</div>';
}
async function loadMine() {
  if (!currentUser) return;
  $('myListingsSection').hidden = false;
  try {
    const snap = await getDocs(query(listingsCol, where('ownerUid','==',currentUser.uid), limit(50)));
    const items = snap.docs.map(d => ({id:d.id,...d.data()})).sort((a,b) => (toDate(b.createdAt)?.getTime() || 0) - (toDate(a.createdAt)?.getTime() || 0));
    renderMine(items.map(item => ({...item,statusLabel:({pending:'На проверке',approved:'Опубликовано',rejected:'Не одобрено',sold:'Продано',service_inactive:'Услуга неактивна',search_closed:'Поиск завершён',expired:'Срок истёк'})[item.status] || 'Статус неизвестен'})));
  } catch (error) { console.warn(error); showNotice('Не удалось загрузить ваши объявления.', true); }
}
async function loadModeration() {
  if (!isAdmin) return;
  $('moderationSection').hidden = false;
  try {
    const snap = await getDocs(query(listingsCol, where('status','==','pending'), limit(100)));
    const items = snap.docs.map(d => ({id:d.id,...d.data()}));
    $('moderationList').innerHTML = items.length ? items.map(item => '<div class="moderation-row"><div><strong>' + safeText(item.title) + '</strong><p>' + safeText(item.category) + ' · ' + safeText(item.location) + ' · ' + safeText(item.phone) + '</p><p>' + safeText(item.description) + '</p></div><div><button class="small-btn approve" data-review="approved" data-id="' + safeText(item.id) + '" type="button">Одобрить</button> <button class="small-btn reject" data-review="rejected" data-id="' + safeText(item.id) + '" type="button">Отклонить</button></div></div>').join('') : '<div class="empty">Нет объявлений на проверке.</div>';
  } catch (error) { console.warn(error); $('moderationList').innerHTML = '<div class="empty">Не удалось загрузить очередь модерации.</div>'; }
}
$('newListingBtn').addEventListener('click', () => { $('formError').textContent = ''; dialog.showModal(); });
$('closeDialogBtn').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
$('searchInput').addEventListener('input', renderCards);
$('categoryFilters').addEventListener('click', event => {
  const button = event.target.closest('[data-category],[data-type]');
  if (!button) return;
  if (button.dataset.category) { activeCategory = button.dataset.category; activeType = 'all'; }
  else { activeType = button.dataset.type; activeCategory = 'all'; }
  $('categoryFilters').querySelectorAll('.filter').forEach(el => el.classList.toggle('active', el === button));
  renderCards();
});
$('refreshMineBtn').addEventListener('click', loadMine);
form.addEventListener('submit', async event => {
  event.preventDefault();
  $('formError').textContent = '';
  const submit = form.querySelector('[type="submit"]');
  const data = new FormData(form);
  const listingType = String(data.get('listingType') || 'offer_product');
  const subcategory = String(data.get('subcategory') || '').trim();
  const priceMode = String(data.get('priceMode') || 'negotiable');
  const title = String(data.get('title') || '').trim();
  const category = String(data.get('category') || '').trim();
  const description = String(data.get('description') || '').trim();
  const location = String(data.get('location') || '').trim();
  const phone = String(data.get('phone') || '').trim();
  const imageUrl = String(data.get('imageUrl') || '').trim();
  const rawPrice = String(data.get('price') || '').replace(/[\s₸]/g,'').trim();
  const price = rawPrice ? Number(rawPrice) : null;
  if (!categories.includes(category) || !['offer_product','offer_service','seek_product','seek_service'].includes(listingType) || (listingType.endsWith('service') && category !== 'Услуги')) { $('formError').textContent = 'Выберите корректную категорию и цель объявления.'; return; }
  if (subcategory.length < 2 || subcategory.length > 80) { $('formError').textContent = 'Укажите, что предлагаете или ищете.'; return; }
  if (rawPrice && (!/^\d{1,10}$/.test(rawPrice) || !Number.isSafeInteger(price) || price < 0)) { $('formError').textContent = 'Укажите корректную цену числом.'; return; }
  if (imageUrl && (!/^https:\/\//i.test(imageUrl) || imageUrl.length > 500)) { $('formError').textContent = 'Ссылка на фото должна начинаться с https://'; return; }
  if (phone.replace(/\D/g,'').length < 10) { $('formError').textContent = 'Проверьте номер телефона.'; return; }
  submit.disabled = true; submit.textContent = 'Отправляем…';
  try {
    const user = await ensureSignIn();
    const now = Timestamp.now();
    await addDoc(listingsCol, {
      ownerUid: user.uid, ownerName: user.displayName || '', title, category, listingType, subcategory, priceMode, description,
      location, phone, price, imageUrl: imageUrl || '', status: 'pending',
      createdAt: serverTimestamp(), expiresAt: Timestamp.fromMillis(now.toMillis() + 3*24*60*60*1000),
      updatedAt: serverTimestamp()
    });
    form.reset(); $('listingTitle').dataset.userEdited = ''; syncFormForType(); dialog.close();
    showNotice('Объявление отправлено на проверку. После одобрения оно появится в каталоге.');
    await loadMine(); await loadModeration();
  } catch (error) {
    console.error(error);
    $('formError').textContent = error.message || 'Не удалось отправить объявление. Попробуйте позже.';
  } finally { submit.disabled = false; submit.textContent = 'Отправить на проверку'; }
});
document.addEventListener('click', async event => {
  const closeButton = event.target.closest('[data-close-listing]');
  const reviewButton = event.target.closest('[data-review]');
  try {
    if (closeButton) {
      if (!currentUser || !confirm('Подтвердить завершение объявления?')) return;
      await updateDoc(doc(db,'classifiedListings',closeButton.dataset.closeListing), {status:closeButton.dataset.nextStatus,updatedAt:serverTimestamp()});
      await loadMine(); await loadListings();
    }
    if (reviewButton) {
      if (!isAdmin) return;
      await updateDoc(doc(db,'classifiedListings',reviewButton.dataset.id), {status:reviewButton.dataset.review,moderatedAt:serverTimestamp(),moderatedBy:currentUser.uid,updatedAt:serverTimestamp()});
      await loadModeration(); await loadListings();
    }
  } catch (error) { console.error(error); showNotice('Действие не выполнено. Проверьте права доступа и повторите.', true); }
});
function suggestedTitle(type, subject) {
  const value = subject.trim();
  if (!value) return '';
  if (type === 'offer_product') return 'Продам ' + value;
  if (type === 'offer_service') return 'Услуги ' + value;
  if (type === 'seek_product') return 'Куплю ' + value;
  return 'Ищу ' + value;
}
function syncFormForType() {
  const type = $('listingType').value;
  const category = $('listingCategory');
  const options = type.endsWith('service')
    ? [['Услуги','Услуги']]
    : [['Куплю / продам','Товары — куплю / продам'],['Недвижимость','Недвижимость'],['Работа','Работа'],['Транспорт','Транспорт'],['Местный бизнес','Местный бизнес']];
  category.replaceChildren(...options.map(([value,label]) => { const option=document.createElement('option'); option.value=value; option.textContent=label; return option; }));
  $('subjectLabel').firstChild.textContent = type === 'offer_product' ? 'Что продаёте? *' : type === 'offer_service' ? 'Какую услугу предлагаете? *' : type === 'seek_product' ? 'Что хотите купить? *' : 'Какого специалиста ищете? *';
  $('listingSubject').placeholder = type === 'offer_product' || type === 'seek_product' ? 'Например: детскую коляску' : type === 'offer_service' ? 'Например: сантехника или электрика' : 'Например: сантехника';
  const modes = type === 'offer_service' ? [['from','Цена от…'],['hour','За час'],['negotiable','По договорённости'],['fixed','Указать цену'],['free','Бесплатно']] : type.startsWith('seek_') ? [['budget','Указать бюджет'],['offer','Предлагайте варианты'],['negotiable','По договорённости']] : [['fixed','Указать цену'],['from','Цена от…'],['negotiable','Торг / договорённость'],['free','Бесплатно']];
  $('priceMode').replaceChildren(...modes.map(([value,label]) => { const option=document.createElement('option'); option.value=value; option.textContent=label; return option; }));
  $('priceLabel').textContent = type === 'offer_service' ? 'Стоимость услуги' : type.startsWith('seek_') ? 'Бюджет' : 'Цена';
  updatePriceInput();
  updateTitle();
}
function updatePriceInput() {
  const mode = $('priceMode').value;
  $('listingPrice').hidden = ['negotiable','offer','free'].includes(mode);
  $('listingPrice').required = ['fixed','from','hour','budget'].includes(mode);
  $('listingPrice').placeholder = mode === 'hour' ? 'Стоимость за час, ₸' : mode === 'budget' ? 'Ваш бюджет, ₸' : mode === 'from' ? 'Цена от, ₸' : 'Сумма в ₸';
  if ($('listingPrice').hidden) $('listingPrice').value = '';
}
function updateTitle() {
  const title = $('listingTitle');
  const suggested = suggestedTitle($('listingType').value, $('listingSubject').value);
  if (!title.dataset.userEdited || !title.value.trim()) title.value = suggested;
  title.placeholder = suggested || 'Заголовок сформируется автоматически';
}
$('listingType').addEventListener('change', () => { $('listingTitle').dataset.userEdited = ''; syncFormForType(); });
$('listingSubject').addEventListener('input', () => { $('listingTitle').dataset.userEdited = ''; updateTitle(); });
$('listingTitle').addEventListener('input', () => { $('listingTitle').dataset.userEdited = '1'; });
$('priceMode').addEventListener('change', updatePriceInput);
syncFormForType();
onAuthStateChanged(auth, async user => {
  currentUser = user;
  isAdmin = await checkAdmin(user);
  if (user) { await loadMine(); await loadModeration(); }
});
loadListings();
