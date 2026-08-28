// Fixed holiday dates are kept separately from yearly transfers and moving holidays.
// The 2026 overrides follow the official production calendar:
// https://www.gov.kz/memleket/entities/enbek/documents/details/1034069?lang=ru
export const ANNUAL_HOLIDAYS = Object.freeze([
    { name: 'Новый год', start: '01-01', end: '01-02' },
    { name: 'Рождество Христово', start: '01-07', end: '01-07' },
    { name: 'Международный женский день', start: '03-08', end: '03-08' },
    { name: 'День Конституции Республики Казахстан', start: '08-30', end: '08-30', throughYear: 2025 },
    { name: 'День Конституции Республики Казахстан', start: '03-15', end: '03-15', fromYear: 2026 },
    { name: 'Наурыз мейрамы', start: '03-21', end: '03-23' },
    { name: 'Праздник единства народа Казахстана', start: '05-01', end: '05-01' },
    { name: 'День защитника Отечества', start: '05-07', end: '05-07' },
    { name: 'День Победы', start: '05-09', end: '05-09' },
    { name: 'День Столицы', start: '07-06', end: '07-06' },
    { name: 'День Республики', start: '10-25', end: '10-25' },
    { name: 'День Независимости', start: '12-16', end: '12-16' }
]);

export const YEAR_SPECIFIC_HOLIDAYS = Object.freeze({
    2026: Object.freeze([
        { name: 'Международный женский день', start: '2026-03-09', end: '2026-03-09', observed: true },
        { name: 'Наурыз мейрамы', start: '2026-03-24', end: '2026-03-25', observed: true },
        { name: 'День Победы', start: '2026-05-11', end: '2026-05-11', observed: true },
        { name: 'Курбан айт', start: '2026-05-27', end: '2026-05-27' },
        { name: 'День Республики', start: '2026-10-26', end: '2026-10-26', observed: true }
    ])
});

export function formatLocalDateKey(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
    const year = String(date.getFullYear());
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function annualHolidayApplies(holiday, year) {
    if (holiday.fromYear && year < holiday.fromYear) return false;
    if (holiday.throughYear && year > holiday.throughYear) return false;
    return true;
}

function holidayResult(holiday, dateKey) {
    return {
        name: holiday.name,
        dateKey,
        start: holiday.start,
        end: holiday.end,
        observed: holiday.observed === true
    };
}

export function getHolidayForDate(date = new Date()) {
    const dateKey = formatLocalDateKey(date);
    if (!dateKey) return null;

    const year = date.getFullYear();
    for (const holiday of ANNUAL_HOLIDAYS) {
        if (!annualHolidayApplies(holiday, year)) continue;
        const start = `${year}-${holiday.start}`;
        const end = `${year}-${holiday.end}`;
        if (dateKey >= start && dateKey <= end) {
            return holidayResult({ ...holiday, start, end }, dateKey);
        }
    }

    const yearlyHolidays = YEAR_SPECIFIC_HOLIDAYS[year] || [];
    for (const holiday of yearlyHolidays) {
        if (dateKey >= holiday.start && dateKey <= holiday.end) {
            return holidayResult(holiday, dateKey);
        }
    }

    return null;
}
