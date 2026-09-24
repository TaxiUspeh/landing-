// Selected coordinates are independent of the address directory and kept in route order.
export function hasCoordinates(point) {
  return Number.isFinite(point?.lat) && Math.abs(point.lat) <= 90
    && Number.isFinite(point?.lon) && Math.abs(point.lon) <= 180;
}

export function coordinatePoint(point) {
  if (!hasCoordinates(point)) throw new Error('Некорректные координаты');
  return { address: `Точка на карте: ${point.lat.toFixed(5)}, ${point.lon.toFixed(5)}`,
    city: '', lat: point.lat, lon: point.lon };
}

export function addressCoordinates(address) {
  const match = String(address || '').match(/^(?:Магазин:\s*)?(?:Точка на карте:|\[КООРДИНАТЫ\]|\[ГЕО\])\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/u);
  const point = match && { lat: Number(match[1]), lon: Number(match[2]) };
  return hasCoordinates(point) ? point : null;
}

export function routeCoordinates(points) {
  return points.map(point => hasCoordinates(point) ? { lat: point.lat, lon: point.lon } : null);
}

export function navigationRoute(order, addresses) {
  const coordinates = Array.isArray(order.routeCoordinates) && order.routeCoordinates.length === addresses.length
    ? order.routeCoordinates : [];
  return addresses.map((address, index) => {
    const point = hasCoordinates(coordinates[index]) ? coordinates[index] : addressCoordinates(address);
    return point ? `${point.lat},${point.lon}` : address;
  }).join('~');
}

// A queued or stalled directory request must not hold up a map selection.
export async function within(promise, milliseconds, fallback = null) {
  let timer;
  try { return await Promise.race([promise, new Promise(resolve => { timer = setTimeout(() => resolve(fallback), milliseconds); })]); }
  catch { return fallback; }
  finally { clearTimeout(timer); }
}
