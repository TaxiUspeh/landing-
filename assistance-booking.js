export const ASSISTANCE_MINIMUM = 1500;
export const ASSISTANCE_TYPES = Object.freeze(['Подкачать колесо', 'Прикурить автомобиль', 'Прочее поручение/помощь']);

export function assistanceDetails({ assistanceType, carModel = '', licencePlate = '', task = '' }) {
  const result = { assistanceType, carModel: carModel.trim(), licencePlate: licencePlate.trim(), task: task.trim() };
  if (!ASSISTANCE_TYPES.includes(assistanceType)) throw new Error('Выберите тип помощи.');
  if (assistanceType === ASSISTANCE_TYPES[2] && !result.task) throw new Error('Опишите, какая помощь нужна.');
  if (result.carModel.length > 120 || result.licencePlate.length > 32 || result.task.length > 700) throw new Error('Сократите марку автомобиля, номер или описание помощи.');
  // Hidden car fields from another service/type must not be submitted.
  if (assistanceType === ASSISTANCE_TYPES[2]) { result.carModel = ''; result.licencePlate = ''; }
  return result;
}
