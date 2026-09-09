import { commissionFor } from './driver-finance.js?v=53';
// Kept free of browser imports so the real transaction can run against the emulator.
export const AUCTION_MIN_PRICE = 500;
export const AUCTION_MAX_PRICE = 1000000;
export const OFFER_LIFETIME_MS = 120000;
export const auctionOfferId = (orderId, driverUid) => `${orderId}_${driverUid}`;
export const validAuctionPrice = value => Number.isInteger(value) && value >= AUCTION_MIN_PRICE && value <= AUCTION_MAX_PRICE;
export const validArrivalMinutes = value => Number.isInteger(value) && value >= 1 && value <= 120;
export const currentAuctionOffer = (offer, order, now = Date.now()) => order?.status === 'bidding'
    && offer.status === 'active' && offer.round === order.auctionRound && offer.expiresAt?.toMillis() > now;

export async function selectAuctionOffer(db, sdk, orderId, displayedOffer, clientUid) {
    const { doc, runTransaction, serverTimestamp } = sdk;
    return runTransaction(db, async transaction => {
        const orderRef = doc(db, 'orders', orderId);
        const offerRef = doc(db, 'auctionOffers', auctionOfferId(orderId, displayedOffer.driverUid));
        const orderSnapshot = await transaction.get(orderRef);
        const offerSnapshot = await transaction.get(offerRef);
        if (!orderSnapshot.exists() || !offerSnapshot.exists()) throw new Error('Предложение больше не доступно.');
        const order = orderSnapshot.data(), offer = offerSnapshot.data();
        if (order.clientUid !== clientUid || !currentAuctionOffer(offer, order)) throw new Error('Предложение истекло или заказ уже изменился.');
        if (!offer.updatedAt?.isEqual(displayedOffer.updatedAt)) throw new Error('Водитель изменил предложение. Проверьте новую цену и время подачи.');
        transaction.update(orderRef, {
            ...(offer.commissionRate !== undefined ? { commissionTerms: { rate: offer.commissionRate, baseAmount: offer.priceAmount, amount: commissionFor(offer.priceAmount, offer.commissionRate) } } : {}),
            status: 'accepted', assignedDriverUid: offer.driverUid, assignedDriverId: offer.driverId,
            driverName: offer.driverName, driverPhone: offer.driverPhone,
            driverCar: offer.driverCar, driverColor: offer.driverColor,
            priceAmount: offer.priceAmount, priceText: `${offer.priceAmount} ₸`,
            selectedOfferId: offerRef.id, arrivalMinutes: offer.arrivalMinutes,
            acceptedAt: serverTimestamp(), updatedAt: serverTimestamp()
        });
        // Availability is checked by rules in the SAME atomic commit. The client
        // does not get read access to private driver accounts or driver states.
        transaction.update(doc(db, 'driverStates', offer.driverUid), {
            status: 'busy', activeOrderId: orderId,
            lastSeen: serverTimestamp(), updatedAt: serverTimestamp()
        });
    });
}
