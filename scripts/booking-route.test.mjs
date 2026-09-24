import test from 'node:test';
import assert from 'node:assert/strict';
import { coordinatePoint, addressCoordinates, navigationRoute, routeCoordinates, within } from '../booking-route.js';

test('unnamed map points retain numeric position without inventing a town', () => {
  const point = coordinatePoint({lat:50.123456,lon:82.987654});
  assert.equal(point.city,''); assert.equal(point.lat,50.123456);
  assert.deepEqual(addressCoordinates(point.address),{lat:50.12346,lon:82.98765});
  assert.throws(()=>coordinatePoint({lat:91,lon:0}));
  assert.equal(addressCoordinates('Чапаева 50, 82'),null);
  assert.equal(addressCoordinates('Точка на карте: 91, 82'),null);
});
test('navigation uses selected coordinates, ordered stops and legacy text fallback', () => {
  const points=[{lat:0,lon:-3},{address:'Чапаева көшесі'},{lat:50.1,lon:82.2}];
  const order={routeCoordinates:routeCoordinates(points)};
  assert.equal(navigationRoute(order,['Старт','Чапаева көшесі','Финиш']),'0,-3~Чапаева көшесі~50.1,82.2');
  assert.equal(navigationRoute({},['Точка на карте: 50.10000, 82.20000','Дом']),'50.1,82.2~Дом');
  assert.equal(navigationRoute({},['Магазин: Точка на карте: 50.10000, 82.20000','Дом']),'50.1,82.2~Дом');
  assert.equal(navigationRoute({routeCoordinates:[{lat:1,lon:2}]},['А','Б']),'А~Б');
});
test('directory timeouts and rejection do not hold a selected point indefinitely', async () => {
  assert.deepEqual(await within(new Promise(()=>{}),10,[]),[]);
  assert.deepEqual(await within(Promise.reject(new Error('offline')),10,[]),[]);
  assert.equal(await within(Promise.resolve('address'),10),'address');
});
