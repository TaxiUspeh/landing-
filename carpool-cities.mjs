// One matching key for client search and server-created trips, including local aliases.
export function carpoolCityKey(value) {
  const key = String(value).normalize('NFKC').toLocaleLowerCase('ru').replace(/ё/g, 'е')
    .replace(/^(поселок|п\.|город|г\.)\s+/u, '').replace(/[\s-]+/g, ' ').trim();
  return ({ 'belousovka':'белоусовка', 'белаусовка':'белоусовка', 'glubokoe':'глубокое', 'glubokoye':'глубокое',
    'уст каменогорск':'усть каменогорск', 'устькаменогорск':'усть каменогорск', 'ust kamenogorsk':'усть каменогорск',
    'oskemen':'усть каменогорск', 'өскемен':'усть каменогорск', 'ridder':'риддер', 'sekisovka':'секисовка' })[key] || key;
}
