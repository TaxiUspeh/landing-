import { auth, db, googleProvider } from './firebase-config.js';
import { onAuthStateChanged, signInWithPopup } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { collection, addDoc, getDocs, getDoc, doc, query, where, Timestamp, updateDoc, orderBy, limit, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const $ = (id) => document.getElementById(id);
const listingsCol = collection(db, 'classifiedListings');
const dialog = $('listingDialog');
const form = $('listingForm');
let currentUser = null;
let isAdmin = false;
let activeCategory = 'all';
let allListings = [];
const categories = ['Куплю / продам', 'Услуги', 'Недвижимость', 'Работа', 'Транспорт', 'Местный бизнес'];
const safeText = (value = '') => String(value).replace(/[&<>"']/g, (ch) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const phoneHref = (phone) => 'tel:' + String(phone || '').replace(/[^+0-9]/g, '');
const formatDate = (date) => date ? new Intl.DateTimeFormat('ru-RU', {day:'numeric',month:'short'}).format(date) : '';
const toDate = (value) => value && typeof value.toDate === 'function' ? value.toDate() : null;
function showNotice(message, error = false) { $('notice').textContent = message; $('notice').style.color = error ? '#a32d25' : ''; }
function categoryIcon(category) { return ({'Куплю / продам':'🛍️','Услуги':'🧰','Недвижимость':'🏠','Работа':'💼','Транспорт':'🚗','Местный бизнес':'🏪'})[category] || '📣'; }

function renderCards() {
  const term = $('searchInput').value.trim().toLocaleLowerCase('ru-RU');
  const filtered = allListings.filter(item => (activeCategory === 'all' || item.category === activeCategory)
    && (!term || [item.title,item.description,item.location,item.category].join(' ').toLocaleLowerCase('ru-RU').includes(term)));
  $('listingCount').textContent = filtered.length + ' объявл.';
  if (!filtered.length) {
    $('listingGrid').innerHTML = '<div class="empty">Пока нет подходящих объявлений. Можно разместить первое — это бесплатно.</div>';
    return;
  }
  $('listingGrid').innerHTML = filtered.map(item => {
    const image = item.imageUrl && /^https:\/\//i.test(item.imageUrl) ? '<img class="listing-photo" loading="lazy" src="' + safeText(item.imageUrl) + '" alt="" referrerpolicy="no-referrer">' : '<div class="listing-photo-placeholder" aria-hidden="true">' + categoryIcon(item.category) + '</div>';
    const price = item.price ? '<div class="price">' + safeText(Number(item.price).toLocaleString('ru-RU')) + ' ₸</div>' : '<div class="price">Цена договорная</div>';
    return '<article class="listing-card">' + image + '<div class="listing-body"><span class="tag">' + safeText(item.category) + '</span><h3>' + safeText(item.title) + '</h3>' + price + '<div class="description">' + safeText(item.description) + '</div><div class="meta"><span>📍 ' + safeText(item.location) + '</span><span>' + formatDate(toDate(item.createdAt)) + '</span></div><a class="contact" href="' + safeText(phoneHref(item.phone)) + '">Позвонить автору</a></div></article>';
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
    $('listingGrid').innerHTML = '<div class="empty">Не удалось загрузить объявления. Проверьте подключение и попробуйте обновить страницу.</div>';
    showNotice('Если ошибка повторяется, администратору нужно проверить правила и индекс Firestore.', true);
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
  $('myListings').innerHTML = items.length ? items.map(item => '<div class="mine-row"><div><strong>' + safeText(item.title) + '</strong><p>' + safeText(item.statusLabel) + (item.expiresAt ? ' · до ' + formatDate(toDate(item.expiresAt)) : '') + '</p></div>' + (item.status === 'approved' ? '<button class="small-btn" data-sold="' + safeText(item.id) + '" type="button">Продано</button>' : '') + '</div>').join('') : '<div class="empty">Вы пока не размещали объявления.</div>';
}
async function loadMine() {
  if (!currentUser) return;
  $('myListingsSection').hidden = false;
  try {
    const snap = await getDocs(query(listingsCol, where('ownerUid','==',currentUser.uid), limit(50)));
    const items = snap.docs.map(d => ({id:d.id,...d.data()})).sort((a,b) => (toDate(b.createdAt)?.getTime() || 0) - (toDate(a.createdAt)?.getTime() || 0));
    renderMine(items.map(item => ({...item,statusLabel:({pending:'На проверке',approved:'Опубликовано',rejected:'Не одобрено',sold:'Продано',expired:'Срок истёк'})[item.status] || 'Статус неизвестен'})));
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
  const button = event.target.closest('[data-category]');
  if (!button) return;
  activeCategory = button.dataset.category;
  $('categoryFilters').querySelectorAll('.filter').forEach(el => el.classList.toggle('active', el === button));
  renderCards();
});
$('refreshMineBtn').addEventListener('click', loadMine);
form.addEventListener('submit', async event => {
  event.preventDefault();
  $('formError').textContent = '';
  const submit = form.querySelector('[type="submit"]');
  const data = new FormData(form);
  const title = String(data.get('title') || '').trim();
  const category = String(data.get('category') || '').trim();
  const description = String(data.get('description') || '').trim();
  const location = String(data.get('location') || '').trim();
  const phone = String(data.get('phone') || '').trim();
  const imageUrl = String(data.get('imageUrl') || '').trim();
  const rawPrice = String(data.get('price') || '').replace(/[\s₸]/g,'').trim();
  const price = rawPrice ? Number(rawPrice) : null;
  if (!categories.includes(category)) { $('formError').textContent = 'Выберите категорию из списка.'; return; }
  if (rawPrice && (!/^\d{1,10}$/.test(rawPrice) || !Number.isSafeInteger(price) || price < 0)) { $('formError').textContent = 'Укажите корректную цену числом.'; return; }
  if (imageUrl && (!/^https:\/\//i.test(imageUrl) || imageUrl.length > 500)) { $('formError').textContent = 'Ссылка на фото должна начинаться с https://'; return; }
  if (phone.replace(/\D/g,'').length < 10) { $('formError').textContent = 'Проверьте номер телефона.'; return; }
  submit.disabled = true; submit.textContent = 'Отправляем…';
  try {
    const user = await ensureSignIn();
    const now = Timestamp.now();
    await addDoc(listingsCol, {
      ownerUid: user.uid, ownerName: user.displayName || '', title, category, description,
      location, phone, price, imageUrl: imageUrl || '', status: 'pending',
      createdAt: serverTimestamp(), expiresAt: Timestamp.fromMillis(now.toMillis() + 3*24*60*60*1000),
      updatedAt: serverTimestamp()
    });
    form.reset(); dialog.close();
    showNotice('Объявление отправлено на проверку. После одобрения оно появится в каталоге.');
    await loadMine(); await loadModeration();
  } catch (error) {
    console.error(error);
    $('formError').textContent = error.message || 'Не удалось отправить объявление. Попробуйте позже.';
  } finally { submit.disabled = false; submit.textContent = 'Отправить на проверку'; }
});
document.addEventListener('click', async event => {
  const soldButton = event.target.closest('[data-sold]');
  const reviewButton = event.target.closest('[data-review]');
  try {
    if (soldButton) {
      if (!currentUser || !confirm('Отметить объявление как проданное?')) return;
      await updateDoc(doc(db,'classifiedListings',soldButton.dataset.sold), {status:'sold',updatedAt:serverTimestamp()});
      await loadMine(); await loadListings();
    }
    if (reviewButton) {
      if (!isAdmin) return;
      await updateDoc(doc(db,'classifiedListings',reviewButton.dataset.id), {status:reviewButton.dataset.review,moderatedAt:serverTimestamp(),moderatedBy:currentUser.uid,updatedAt:serverTimestamp()});
      await loadModeration(); await loadListings();
    }
  } catch (error) { console.error(error); showNotice('Действие не выполнено. Проверьте права доступа и повторите.', true); }
});
onAuthStateChanged(auth, async user => {
  currentUser = user;
  isAdmin = await checkAdmin(user);
  if (user) { await loadMine(); await loadModeration(); }
});
loadListings();
