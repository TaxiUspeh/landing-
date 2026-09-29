function carpoolBookingMessage(before, after, bookingId) {
  if (!after || before?.status === after.status || !['confirmed', 'cancelled', 'disputed'].includes(after.status)) return null;
  return { type: 'carpool', orderId: `carpool_${bookingId}`, title: after.status === 'confirmed' ? 'Новая бронь в вашей попутке' : after.status === 'cancelled' ? 'Бронь попутки отменена' : 'Бронь передана диспетчеру',
    body: 'Откройте раздел «Попутки», чтобы проверить места и пассажиров.', url: 'https://taxiuspeh.github.io/landing-/drivers.html?carpool=1' };
}
module.exports = { carpoolBookingMessage };

const { createHash } = require('node:crypto');
const digest = value => createHash('sha256').update(value).digest('hex');
const ms = value => value?.toMillis?.() ?? (value?.seconds ? value.seconds * 1000 : 0);
function mayReceivePassengerRequest(driver) {
  return driver?.status === 'active' && driver.carpoolEnabled === true && driver.passengerEnabled !== false && (driver.passengerStatus || 'active') === 'active';
}
function passengerRequestMessage(row, requestId, now = Date.now()) {
  if (row?.status !== 'open' || ms(row.departureAt) <= now || !ms(row.createdAt) || now - ms(row.createdAt) > 300000) return null;
  return { type:'passenger_request', requestId, orderId:`passenger_request_${requestId}`, createdAt:String(ms(row.createdAt)),
    title:'Новая заявка · Ищу машину', body:'Пассажир ищет попутку. Откройте заявку, чтобы посмотреть маршрут и связаться.',
    url:`https://taxiuspeh.github.io/landing-/drivers.html?carpool=1&request=${encodeURIComponent(requestId)}` };
}
function createPassengerRequestPush({ db, messaging, Timestamp, eligibleSubscriptions, now = Date.now }) {
  return async event => {
    const id = event.params.requestId;
    if (!passengerRequestMessage(event.data?.data(), id, now())) return;
    const requestRef = db.doc(`passenger_requests/${id}`);
    const data = passengerRequestMessage((await requestRef.get()).data(), id, now());
    if (!data) return;
    const subscriptions = await eligibleSubscriptions('', null, mayReceivePassengerRequest);
    if (!subscriptions.length) return;
    const ref = db.doc(`driverPushDeliveries/${digest(`passenger-request:${id}`)}`);
    const delivered = await db.runTransaction(async tx => {
      const record = (await tx.get(ref)).data() || {};
      if (record.complete) return null;
      if (ms(record.leaseUntil) > now()) throw new Error('Request notification is already being sent');
      tx.set(ref, { ...record, requestId:id, leaseUntil:Timestamp.fromMillis(now()+90000), expiresAt:Timestamp.fromMillis(now()+7*86400000) });
      return record.delivered || [];
    });
    if (!delivered) return;
    const done = new Set(delivered);
    const unique = new Map(subscriptions.map(snap => [snap.data().token, snap]));
    const pending = [...unique.values()].filter(snap => !done.has(digest(snap.data().token)));
    try {
      for (let index=0; index<pending.length; index+=500) {
        if (!passengerRequestMessage((await requestRef.get()).data(), id, now())) break;
        const group=pending.slice(index,index+500);
        const response=await messaging.sendEachForMulticast({data,tokens:group.map(s=>s.data().token),webpush:{headers:{TTL:'300',Urgency:'high'},fcmOptions:{link:data.url}}});
        let failed=false;
        for(let i=0;i<response.responses.length;i++) {
          const result=response.responses[i], snap=group[i], token=snap.data().token;
          if(result.success) done.add(digest(token));
          else if(['messaging/invalid-registration-token','messaging/registration-token-not-registered'].includes(result.error?.code)) {
            await db.runTransaction(async tx=>{const current=await tx.get(snap.ref);if(current.data()?.token===token)tx.delete(snap.ref);});
            done.add(digest(token));
          } else failed=true;
        }
        await ref.set({delivered:[...done]},{merge:true});
        if(failed) throw new Error('Request notification temporarily unavailable');
      }
      await ref.set({complete:true,leaseUntil:Timestamp.fromMillis(0)},{merge:true});
    } catch(error) { await ref.set({delivered:[...done],leaseUntil:Timestamp.fromMillis(0)},{merge:true}); throw error; }
  };
}
Object.assign(module.exports,{mayReceivePassengerRequest,passengerRequestMessage,createPassengerRequestPush});
