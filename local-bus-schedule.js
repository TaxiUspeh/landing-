import { getHolidayForDate } from './holiday-calendar.js';

// Local route supplied and clarified by the operator on 26 September 2026.
export const LOCAL_BUS_STOPS = Object.freeze([
  ['college', 'КГКП «Глубоковский аграрный колледж»', 0],
  ['forpost', 'Магазин «Форпост»', 2],
  ['selpo', 'Сельпо', 4],
  ['kopeika', 'Магазин «Копейка»', 6],
  ['lenina', 'Улица Ленина', 8],
  ['school1', 'Школа №1', 10],
  ['center-life', 'Магазин «Центр Лайф»', 12],
  ['aliya', 'Магазин «Алия»', 14],
  ['bus-station', 'Напротив автостанции (ул. Жукова)', 16],
  ['vgsch', 'ВГСЧ', 18],
  ['crossroads', 'Перекрёсток', 20],
  ['mine', 'Шахта', 22],
  ['bakery', 'Хлебзавод', 24],
  ['factory', 'Фабрика', 26],
  ['store59', 'Магазин №59', 28],
  ['daniyar', 'Магазин «Данияр»', 29],
  ['terekhovka', 'Район «Тереховка»', 30]
].map(([id, name, offset]) => Object.freeze({ id, name, offset })));

export function localBusRoute(direction = 'outbound') {
  return direction === 'inbound'
    ? [...LOCAL_BUS_STOPS].reverse().map(stop => ({ ...stop, offset: 30 - stop.offset }))
    : LOCAL_BUS_STOPS.map(stop => ({ ...stop }));
}

export function localBusDepartures(dayType = 'weekday', direction = 'outbound') {
  const back = direction === 'inbound';
  const first = back ? 450 : 420;
  const last = dayType === 'weekend' ? (back ? 870 : 840) : (back ? 1170 : 1200);
  return Array.from({ length: (last - first) / 60 + 1 }, (_, index) => first + index * 60);
}

export function localBusStopTimes(dayType, direction, stopId) {
  const stop = localBusRoute(direction).find(item => item.id === stopId);
  return stop ? localBusDepartures(dayType, direction).map(departure => ({ departure, time: departure + stop.offset })) : [];
}

export const busTime = minutes => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

const clockFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Almaty', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
});
export function belousovkaBusClock(date = new Date()) {
  const parts = Object.fromEntries(clockFormat.formatToParts(date).map(part => [part.type, part.value]));
  // A local calendar date for the shared holiday helper, independent of the device timezone.
  const calendarDate = new Date(Number(parts.year), Number(parts.month) - 1, Number(parts.day), 12);
  const holiday = getHolidayForDate(calendarDate);
  const weekday = calendarDate.getDay();
  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
    weekday, holiday: holiday?.name || '',
    dayType: holiday || weekday === 0 || weekday === 6 ? 'weekend' : 'weekday'
  };
}
