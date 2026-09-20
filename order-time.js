// Order timestamps use the service's time zone, independently of device settings.
const TIME_ZONE = 'Asia/Almaty';
const clock = new Intl.DateTimeFormat('ru-RU', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const calendar = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
const dateFormat = year => new Intl.DateTimeFormat('ru-RU', { timeZone: TIME_ZONE, day: 'numeric', month: 'long', ...(year ? { year: 'numeric' } : {}) });
function dateKey(value) {
  const parts = Object.fromEntries(calendar.formatToParts(value).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function timestampMillis(value) {
  try {
    const ms = value?.toMillis ? value.toMillis() : value instanceof Date ? value.getTime() : NaN;
    return Number.isFinite(ms) && ms > 0 && !Number.isNaN(new Date(ms).getTime()) ? ms : null;
  } catch { return null; }
}
function ageText(elapsed) {
  const minutes = Math.floor(Math.max(0, elapsed) / 60000);
  if (!minutes) return 'только что';
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  return `${hours} ч${rest ? ` ${rest} мин` : ''} назад`;
}
function scheduledInfo(value, now) {
  if (!value) return { text: '', future: false, valid: true };
  // datetime-local is a wall-clock appointment, not a UTC timestamp.
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2})?$/.exec(value);
  if (!match) return { text: `Подача: ${String(value).replace('T', ' ')}`, future: false, valid: false };
  const [, year, month, day, hour, minute] = match;
  const noon = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 12));
  if (dateKey(noon) !== `${year}-${month}-${day}` || Number(hour) > 23 || Number(minute) > 59) {
    return { text: 'Время подачи нужно уточнить у диспетчера', future: false, valid: false };
  }
  const today = dateKey(now), dayKey = `${year}-${month}-${day}`;
  const date = dayKey === today ? 'сегодня' : dateFormat(year !== today.slice(0, 4)).format(noon);
  return { text: `Подача ${date} в ${hour}:${minute}`, valid: true, future: `${dayKey}T${hour}:${minute}` > `${today}T${clock.format(now)}` };
}
export function orderTimeInfo(order, now = Date.now()) {
  const created = timestampMillis(order.createdAt), schedule = scheduledInfo(order.scheduledFor, now);
  if (created === null) return { createdText: 'Время создания не указано', dateTime: '', title: '', scheduledText: schedule.text, waiting: false };
  const today = dateKey(now), createdDay = dateKey(created), elapsed = now - created;
  const absolute = createdDay === today ? `в ${clock.format(created)}` : `${dateFormat(createdDay.slice(0, 4) !== today.slice(0, 4)).format(created)}, ${clock.format(created)}`;
  const relative = elapsed >= -60000 && elapsed < 86400000 ? ` · ${ageText(elapsed)}` : '';
  return {
    createdText: `Создан ${absolute}${relative}`,
    dateTime: new Date(created).toISOString(),
    title: `${dateFormat(true).format(created)}, ${clock.format(created)} (время службы)`,
    scheduledText: schedule.text,
    waiting: ['searching', 'bidding'].includes(order.status) && elapsed >= 10 * 60000 && schedule.valid && !schedule.future
  };
}
