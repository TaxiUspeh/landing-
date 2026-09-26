import test from 'node:test';
import assert from 'node:assert/strict';
import { LOCAL_BUS_STOPS, localBusRoute, localBusDepartures, localBusStopTimes, busTime, belousovkaBusClock } from '../local-bus-schedule.js';

test('weekday departures end at 20:00 outbound and 19:30 inbound, without a 20:30 return', () => {
  assert.deepEqual(localBusDepartures('weekday', 'outbound').map(busTime), ['07:00','08:00','09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00','18:00','19:00','20:00']);
  assert.deepEqual(localBusDepartures('weekday', 'inbound').map(busTime), ['07:30','08:30','09:30','10:30','11:30','12:30','13:30','14:30','15:30','16:30','17:30','18:30','19:30']);
});
test('weekend and holiday service finishes at the college at 15:00', () => {
  assert.equal(localBusDepartures('weekend','outbound').length,8);
  assert.equal(busTime(localBusDepartures('weekend','outbound').at(-1)),'14:00');
  assert.equal(busTime(localBusDepartures('weekend','inbound').at(-1)),'14:30');
  assert.equal(busTime(localBusStopTimes('weekend','inbound','college').at(-1).time),'15:00');
  assert.equal(busTime(localBusStopTimes('weekend','outbound','terekhovka').at(-1).time),'14:30');
});
test('all 17 stops keep the supplied minute offsets in both directions', () => {
  assert.equal(LOCAL_BUS_STOPS.length,17);
  assert.deepEqual(localBusRoute('outbound').map(stop=>busTime(420+stop.offset)),['07:00','07:02','07:04','07:06','07:08','07:10','07:12','07:14','07:16','07:18','07:20','07:22','07:24','07:26','07:28','07:29','07:30']);
  assert.deepEqual(localBusRoute('inbound').map(stop=>busTime(450+stop.offset)),['07:30','07:31','07:32','07:34','07:36','07:38','07:40','07:42','07:44','07:46','07:48','07:50','07:52','07:54','07:56','07:58','08:00']);
  assert.equal(localBusRoute('inbound')[1].id,'daniyar');
});
test('boarding times use the chosen stop, including a bus already away from its terminal', () => {
  const upcoming=localBusStopTimes('weekday','outbound','school1').filter(item=>item.time>=605);
  assert.deepEqual(upcoming[0],{departure:600,time:610});
  assert.deepEqual(localBusStopTimes('weekday','inbound','school1')[0],{departure:450,time:470});
  assert.deepEqual(localBusStopTimes('weekday','outbound','missing'),[]);
});
test('today follows Belousovka calendar and midnight rather than the device timezone', () => {
  const friday=belousovkaBusClock(new Date('2026-09-25T18:59:00Z'));
  const saturday=belousovkaBusClock(new Date('2026-09-25T19:00:00Z'));
  assert.equal(friday.dateKey,'2026-09-25');assert.equal(friday.dayType,'weekday');assert.equal(friday.minutes,1439);
  assert.equal(saturday.dateKey,'2026-09-26');assert.equal(saturday.dayType,'weekend');assert.equal(saturday.minutes,0);
});
test('known holidays and transferred days select the shorter timetable', () => {
  for(const date of ['2026-05-27T05:00:00Z','2026-10-26T05:00:00Z','2026-12-16T05:00:00Z']) {
    const clock=belousovkaBusClock(new Date(date));assert.equal(clock.dayType,'weekend');assert.ok(clock.holiday);
  }
  assert.equal(belousovkaBusClock(new Date('2026-10-27T05:00:00Z')).dayType,'weekday');
});
