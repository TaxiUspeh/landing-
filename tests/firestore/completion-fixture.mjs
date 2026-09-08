import { doc, runTransaction, serverTimestamp } from 'firebase/firestore';
export async function complete(db, { omit = '', commission = 220 } = {}) {
  return runTransaction(db, async tx => {
    const orderRef = doc(db, 'orders', 'order-a');
    const stateRef = doc(db, 'driverStates', 'driver-a');
    const driverRef = doc(db, 'drivers', 'd-a');
    const historyRef = doc(db, 'balanceHistory', 'order-a');
    const order = (await tx.get(orderRef)).data();
    await tx.get(stateRef);
    const driver = (await tx.get(driverRef)).data();
    const history = await tx.get(historyRef);
    if (history.exists()) throw new Error('Commission already recorded');
    const previousBalance = driver.balance;
    const newBalance = previousBalance + commission;
    if (omit !== 'balance') tx.update(driverRef, { balance: newBalance, lastCommissionOrderId: 'order-a', updatedAt: serverTimestamp() });
    if (omit !== 'history') tx.set(historyRef, {
      driverId: 'd-a', driverNumber: driver.driverNumber, orderId: 'order-a', orderNumber: order.orderNumber,
      source: 'online', commissionRate: 20, commissionBaseAmount: order.priceAmount, commissionAmount: commission,
      previousBalance, newBalance, difference: commission,
      reason: order.auctionRound ? 'Комиссия 20% от согласованной цены аукциона' : 'Комиссия 20% от максимальной цены онлайн-заказа', changedAt: serverTimestamp(), changedBy: 'driver-a'
    });
    tx.update(orderRef, {
      status: 'completed', updatedAt: serverTimestamp(), commissionRate: 20,
      commissionBaseAmount: order.priceAmount, commissionAmount: commission,
      commissionBalanceBefore: previousBalance, commissionBalanceAfter: newBalance, commissionChargedAt: serverTimestamp()
    });
    if (omit !== 'state') tx.update(stateRef, { status: 'available', activeOrderId: '', lastSeen: serverTimestamp(), updatedAt: serverTimestamp() });
  });
}
