function carpoolBookingMessage(before, after, bookingId) {
  if (!after || before?.status === after.status || !['confirmed', 'cancelled', 'disputed'].includes(after.status)) return null;
  return { type: 'carpool', orderId: `carpool_${bookingId}`, title: after.status === 'confirmed' ? 'Новая бронь в вашей попутке' : after.status === 'cancelled' ? 'Бронь попутки отменена' : 'Бронь передана диспетчеру',
    body: 'Откройте раздел «Попутки», чтобы проверить места и пассажиров.', url: 'https://taxiuspeh.github.io/landing-/drivers.html?carpool=1' };
}
module.exports = { carpoolBookingMessage };
