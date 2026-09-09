// Positive balance is debt; negative balance is prepaid credit (existing storage convention).
export const DEFAULT_FINANCE = Object.freeze({ commissionRate: 20, debtMode: 'unlimited', debtLimit: 0 });
export const NEW_DRIVER_FINANCE = Object.freeze({ commissionRate: 20, debtMode: 'none', debtLimit: 0 });
export const hasFinanceSettings = driver => ['commissionRate', 'debtMode', 'debtLimit'].some(key => Object.hasOwn(driver, key));
export function financeSettings(driver = {}) {
    return { commissionRate: driver.commissionRate ?? 20, debtMode: driver.debtMode ?? 'unlimited', debtLimit: driver.debtLimit ?? 0 };
}
export function validFinanceSettings(settings) {
    return Number.isInteger(settings.commissionRate) && settings.commissionRate >= 0 && settings.commissionRate <= 100
        && ['none', 'limited', 'unlimited'].includes(settings.debtMode)
        && Number.isInteger(settings.debtLimit) && settings.debtLimit >= 0 && settings.debtLimit <= 10000000
        && (settings.debtMode === 'limited' ? settings.debtLimit > 0 : settings.debtLimit === 0);
}
export const moneyRound = amount => Math.round(amount * 100) / 100;
export function commissionFor(price, rate) {
    if (!Number.isFinite(price) || price < 0 || price > 10000000 || !Number.isInteger(rate) || rate < 0 || rate > 100) throw new Error('Некорректная цена или процент комиссии.');
    return Math.round(price * rate) / 100;
}
export function fundingFor(driver, price) {
    const settings = financeSettings(driver), balance = Number(driver.balance);
    if (!validFinanceSettings(settings) || !Number.isFinite(balance)) return { allowed: false, reason: 'Попросите диспетчера проверить баланс и условия комиссии.', shortfall: null };
    const amount = commissionFor(price, settings.commissionRate);
    const ceiling = settings.debtMode === 'none' ? 0 : settings.debtLimit;
    const shortfall = settings.debtMode === 'unlimited' ? 0 : Math.max(0, moneyRound(balance + amount - ceiling));
    return { allowed: shortfall === 0, amount, rate: settings.commissionRate, shortfall,
        reason: shortfall ? `Недостаточно средств для комиссии. Пополните баланс на ${shortfall.toLocaleString('ru-RU')} ₸.` : '' };
}
export function hasOrderFunds(driver) {
    const settings = financeSettings(driver), balance = Number(driver.balance);
    if (!validFinanceSettings(settings) || !Number.isFinite(balance)) return false;
    return settings.debtMode === 'unlimited' || (settings.commissionRate === 0 ? fundingFor(driver, 0).allowed : balance < (settings.debtMode === 'none' ? 0 : settings.debtLimit));
}
export function reserveCommission(driver, price) {
    const funding = fundingFor(driver, price);
    if (!funding.allowed) throw new Error(funding.reason);
    // Legacy profiles continue to work before the owner publishes the new rules.
    return hasFinanceSettings(driver) ? { commissionTerms: { rate: funding.rate, baseAmount: price, amount: funding.amount } } : {};
}
export function orderCommission(order) {
    const terms = order.commissionTerms;
    if (!terms) return { rate: 20, baseAmount: Number(order.priceAmount), amount: Number(order.priceAmount) / 5 };
    if (terms.baseAmount !== order.priceAmount || terms.amount !== commissionFor(terms.baseAmount, terms.rate)) throw new Error('Условия комиссии заказа повреждены. Обратитесь к диспетчеру.');
    return terms;
}
export const commissionReason = order => `Комиссия ${orderCommission(order).rate}% от ${order.auctionRound ? 'согласованной цены аукциона' : 'максимальной цены онлайн-заказа'}`;
export const reservedCommission = orders => moneyRound(orders.filter(order => ['accepted', 'en_route', 'arrived', 'in_trip'].includes(order.status)).reduce((sum, order) => sum + orderCommission(order).amount, 0));
export function financeSummary(driver, reserved = 0) {
    const settings = financeSettings(driver), balance = Number(driver.balance);
    const fmt = value => value.toLocaleString('ru-RU') + ' ₸';
    const limit = settings.debtMode === 'none' ? 'Долг запрещён' : settings.debtMode === 'unlimited' ? 'Без лимита долга' : `Лимит долга: ${fmt(settings.debtLimit)}`;
    const available = settings.debtMode === 'unlimited' ? 'без ограничения' : fmt(Math.max(0, moneyRound((settings.debtMode === 'none' ? 0 : settings.debtLimit) - balance - reserved)));
    return `Комиссия: ${settings.commissionRate}% · ${balance > 0 ? 'Долг' : 'На счёте'}: ${fmt(Math.abs(balance))} · ${limit} · Зарезервировано: ${fmt(reserved)} · Доступно для комиссии: ${available}`;
}
