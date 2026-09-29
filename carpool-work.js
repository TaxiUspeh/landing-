import { el, button, field, report, run, tripCard, callLink, carpoolDate, carpoolMoney, carpoolStatus, carpoolMillis } from './carpool-common.js?v=82';
import { initPassengerDemand } from './carpool-requests.js?v=85';

export function initCarpoolWork(host, api, admin = false) {
  if (!host) return null;
  host.classList.add('carpool');
  const status = el('p', '', 'carpool-status'); status.setAttribute('role', 'status');
  const create = el('details'), createTitle = el('summary', 'Создать поездку'); create.append(createTitle);
  const rate = el('p'), list = el('div'), history = el('details'); history.append(el('summary', 'История рейсов'));
  const historyList = el('div'); history.append(historyList);
  host.append(el('p', admin ? 'Рейсы, пассажиры и комиссия. Спорные отмены подтверждает диспетчер.' : 'Межгород по местам. Вы сами задаёте цену. Выезд в указанное время, даже если салон заполнен не полностью.'), status, rate);
  if (!admin) host.append(create);
  host.append(list, history);
  const tripsPanel = el('section'), demandPanel = el('section'); demandPanel.hidden = true;
  while (host.firstChild) tripsPanel.append(host.firstChild);
  const navigation = el('div', '', 'carpool-tabs'); navigation.setAttribute('role', 'group'); navigation.setAttribute('aria-label', 'Разделы попуток');
  const demand = initPassengerDemand(demandPanel, api, admin);
  const tripsTab = button('Мои рейсы', () => selectTab(false)), demandTab = button('Заявки от пассажиров', () => selectTab(true));
  if (admin) tripsTab.textContent = 'Рейсы водителей';
  navigation.append(tripsTab, demandTab); host.append(navigation, tripsPanel, demandPanel);
  function selectTab(showDemand) { tripsPanel.hidden = showDemand; demandPanel.hidden = !showDemand; tripsTab.setAttribute('aria-pressed', String(!showDemand)); demandTab.setAttribute('aria-pressed', String(showDemand)); demand.show(showDemand); }
  selectTab(false);
  let uid = '', driver = null, ready = false, simpleReady = false, stop = null, revision = 0;
  const passengers = new Set(), expanded = new Set();
  const error = () => report(status, 'Не удалось обновить рейсы. Проверьте подключение и опубликованные правила Firebase.', true);
  const form = tripForm(null); create.append(form);
  function tripForm(trip) {
    const form = el('form', '', 'carpool-form');
    const from = field(form, 'Откуда', 'fromCity', trip?.fromCity || 'Белоусовка'); from.maxLength = 100;
    const to = field(form, 'Куда', 'toCity', trip?.toCity || 'Усть-Каменогорск'); to.maxLength = 100;
    const local = new Date((trip ? carpoolMillis(trip.departureAt) : Date.now() + 3600000) + 5 * 3600000).toISOString().slice(0,16);
    field(form, 'Выезд · время Казахстана (UTC+5)', 'departure', local, 'datetime-local');
    field(form, 'Место посадки', 'pickup', trip?.pickup || '').maxLength = 200;
    field(form, 'Место высадки', 'dropoff', trip?.dropoff || '').maxLength = 200;
    const seats = field(form, 'Свободные пассажирские места', 'totalSeats', trip?.totalSeats || '3', 'number'); seats.min = '1'; seats.max = '8'; seats.step = '1';
    const price = field(form, 'Цена за одно место, ₸', 'seatPrice', trip?.seatPrice || '', 'number'); price.min = '1'; price.max = '1000000'; price.step = '1';
    const phone = field(form, 'Ваш контактный телефон', 'phone', driver?.phone || '', 'tel'); phone.maxLength = 32;
    field(form, 'Багаж и условия (необязательно)', 'luggage', trip?.luggage || '', 'textarea', false).maxLength = 300;
    const amount = el('p'), message = el('p'); message.setAttribute('role','status');
    const submit = el('button', trip ? 'Сохранить изменения' : 'Опубликовать поездку', 'carpool-primary'); submit.type = 'submit';
    const refresh = () => { const percent = trip?.commissionRate ?? driver?.carpoolCommissionRate ?? driver?.commissionRate ?? 20;
      amount.textContent = price.value ? `Комиссия ${percent}%: ${carpoolMoney(Math.round(Number(price.value) * percent) / 100)} за перевезённое место. Пустые места не оплачиваются.` : 'Укажите цену за одно место.'; };
    price.oninput = refresh; refresh(); form.append(amount, el('p', 'После первой брони маршрут, время и цена будут зафиксированы.'), submit, message);
    form.onsubmit = event => {
      event.preventDefault(); if (!form.reportValidity()) return;
      const values = Object.fromEntries(new FormData(form)), data = { ...values, action: trip ? 'edit' : 'publish',
        ...(trip ? { tripId: trip.id } : {}), departureMs: Date.parse(values.departure + '+05:00'), totalSeats: Number(values.totalSeats), seatPrice: Number(values.seatPrice) };
      delete data.departure;
      void run(submit, message, async () => { await api.command(data); create.open = false; report(status, trip ? 'Изменения сохранены.' : 'Рейс опубликован. Пассажиры могут бронировать места.'); });
    };
    return form;
  }
  function reasonForm(card, trip, action, caption) {
    const details = el('details'); details.append(el('summary', caption));
    const form = el('form', '', 'carpool-form'), reason = field(form, 'Причина', 'reason', '', 'textarea'); reason.maxLength = 300;
    const submit = el('button', caption), message = el('p'); submit.type = 'submit'; message.setAttribute('role','status'); form.append(submit, message); details.append(form); card.append(details);
    form.onsubmit = event => { event.preventDefault(); if (form.reportValidity()) void run(submit, message, () => api.command({ action, tripId: trip.id, reason: reason.value.trim() })); };
  }
  function showPassengers(details, trip) {
    let unsubscribe = null, request = 0;
    const items = el('div'); details.append(items);
    const cleanup = () => { unsubscribe?.(); unsubscribe = null; request++; }; passengers.add(cleanup);
    details.addEventListener('toggle', () => {
      if (!details.open) { expanded.delete(trip.id); cleanup(); return; }
      expanded.add(trip.id); if (unsubscribe) return;
      unsubscribe = api.watchPassengers(trip, admin, async bookings => {
        const generation = ++request; items.replaceChildren();
        if (!bookings.length) items.append(el('p', 'Бронирований пока нет.'));
        for (const booking of bookings) {
          const card = el('section', '', 'carpool-passenger'), message = el('p'); message.setAttribute('role','status');
          card.append(el('strong', `${booking.seats} мест · ${carpoolMoney(booking.amount)}`), el('p', carpoolStatus(booking.status)));
          if (booking.reason) card.append(el('p', booking.reason)); items.append(card);
          try { const contact = await api.read('carpoolContacts', booking.id); if (generation !== request) return;
            card.prepend(el('p', contact?.name || 'Пассажир')); card.append(callLink(contact?.phone, 'Позвонить пассажиру'));
          } catch { if (generation === request) card.append(el('p', 'Контакт временно недоступен.')); }
          if (['confirmed','in_trip','disputed','boarded'].includes(booking.status)) {
            if (booking.status === 'confirmed' || admin) {
              const details = el('details'); details.append(el('summary', admin ? 'Решение диспетчера' : 'Неявка / проблема'));
              const form = el('form', '', 'carpool-form'), reason = field(form, 'Комментарий', 'reason', '', 'textarea'); reason.maxLength = 300;
              if (admin) {
                const label = el('label', 'Решение'), choice = el('select'); choice.name = 'outcome';
                for (const [value,text] of [['cancelled','Отменить бронь без комиссии'],['participating','Пассажир едет']]) {const option=el('option',text);option.value=value;choice.append(option);} label.append(choice);form.append(label);
              }
              const send = el('button', admin ? 'Сохранить решение' : 'Передать диспетчеру'); send.type='submit';form.append(send);details.append(form);card.append(details);
              form.onsubmit=event=>{event.preventDefault();if(form.reportValidity())void run(send,message,()=>api.command({action:admin?'resolve':'dispute',tripId:trip.id,bookingId:booking.id,reason:reason.value.trim(),...(admin?{outcome:form.elements.outcome.value}:{})}));};
            }
          }
          card.append(message);
        }
      }, error);
    });
    details.open = expanded.has(trip.id);
  }
  function render(trips) {
    passengers.forEach(stop=>stop()); passengers.clear(); list.replaceChildren(); historyList.replaceChildren();
    const active=trips.filter(t=>['open','closed','in_trip'].includes(t.status));
    create.hidden=admin || !ready || !driver?.carpoolEnabled || active.length>0;
    if(!active.length) list.append(el('p',admin?'Активных рейсов пока нет.':'Активной поездки пока нет.'));
    for(const trip of trips){
      const card=tripCard(trip), message=el('p'); message.setAttribute('role','status');
      card.append(el('p',`Комиссия рейса: ${trip.commissionRate}% · резерв ${carpoolMoney(trip.reservedAmount)}`));
      if(trip.status==='completed')card.append(el('p',`Доход по броням: ${carpoolMoney(trip.revenue)} · комиссия ${carpoolMoney(trip.commissionAmount)}`));
      const details=el('details');details.append(el('summary','Пассажиры и бронирования'));showPassengers(details,trip);card.append(details);
      const actions=el('div','','carpool-actions');
      const action=(label,action,disabled=false)=>{const control=button(label,event=>void run(event.currentTarget,message,()=>api.command({action,tripId:trip.id})));control.disabled=disabled;actions.append(control);};
      if(['open','closed'].includes(trip.status)){
        if(!trip.priceLocked){const edit=el('details');edit.append(el('summary','Изменить поездку'));const form=tripForm(trip);edit.append(form);card.append(edit);
          edit.addEventListener('toggle',async()=>{if(edit.open&&!form.elements.phone.value){try{const contact=await api.read('carpoolTripContacts',trip.id);form.elements.phone.value=contact?.phone||'';}catch{}}});}
        if(trip.status==='open')action('Закрыть набор','close');else if(trip.availableSeats>0)action('Открыть набор','reopen');
        card.append(el('p', simpleReady ? 'Нажмите «Начать поездку», когда пассажиры готовы. Все действующие брони перейдут в статус «В пути». Неявку отметьте до выезда.' : 'Управление поездкой временно обновляется. Свяжитесь с диспетчером.'));
        action('Начать поездку','start',!simpleReady);reasonForm(card,trip,'cancelTrip','Отменить рейс');
      }
      if(trip.status==='in_trip'){action('Завершить поездку','complete');if(admin)reasonForm(card,trip,'cancelTrip','Отменить поездку в пути');}
      card.append(actions,message);(['open','closed','in_trip'].includes(trip.status)?list:historyList).append(card);
    }
    history.hidden=!historyList.children.length;
  }
  async function setContext(user, profile = null) {
    driver=profile; const nextUid=user?.uid||'';
    if (nextUid !== uid && !admin) form.elements.phone.value = profile?.phone || '';
    const allowed=profile?.carpoolEnabled===true&&profile?.status==='active'&&profile?.passengerEnabled!==false&&(profile?.passengerStatus||'active')==='active';
    demand.setContext(user, admin || allowed);
    if(!admin){create.hidden=!ready||!allowed||!!profile?.carpoolActiveTripId;rate.textContent=allowed?`Ваша комиссия за попутки: ${profile.carpoolCommissionRate??profile.commissionRate??20}%. Один открытый рейс на водителя.`:'Публикацию рейсов включает диспетчер в вашей карточке: «Попутки».';
      form.elements.phone.value ||= profile?.phone||'';form.elements.totalSeats.max=String(profile?.passengerSeats||4);}
    if(nextUid===uid)return;
    stop?.();stop=null;passengers.forEach(stop=>stop());passengers.clear();uid=nextUid;const generation=++revision;list.replaceChildren();historyList.replaceChildren();
    if(!uid){ready=false;create.hidden=true;return;}
    report(status,'Загружаем рейсы…');
    const loaded=await Promise.all([api.ready(),api.simpleJourneyReady()]);if(generation!==revision)return;
    [ready,simpleReady]=loaded;
    if(!ready){report(status,'Попутки пока не подключены. Обновите страницу после подключения.');create.hidden=true;return;}
    report(status,'Рейсы обновляются автоматически.');
    stop=admin?api.watchAdminTrips(render,error):api.watchDriverTrips(uid,render,error);
  }
  return {setContext,openRequests(id = ''){selectTab(true);if(id)demand.focus(id);},destroy(){demand.destroy();stop?.();passengers.forEach(stop=>stop());passengers.clear();revision++;uid='';list.replaceChildren();historyList.replaceChildren();create.hidden=true;}};
}
