const names = new Intl.Collator('ru');
const normalize = (text) => text.toLocaleLowerCase('ru').replaceAll('ё', 'е');

export const availabilityOptions = [
  ['', 'Все карты'], ['owned', 'Доступные'], ['missing', 'Недоступные'],
];

export function matchesAvailability(availability, copies) {
  if (availability === 'owned') return copies > 0;
  if (availability === 'missing') return !copies;
  return true;
}

export function filterCatalog(cards, { query = '', faction = '', type = '', rarity = '',
  category = '', provision = '', sort = 'provision', availability = '', owned = {} } = {}) {
  const terms = normalize(query).trim().split(/\s+/).filter(Boolean);
  const shown = cards.filter((card) =>
    !card.token &&
    (!faction || card.faction === faction) &&
    matchesAvailability(availability, owned[card.id]) &&
    (!type || card.type === type) &&
    (!rarity || card.rarity === rarity) &&
    (!category || card.categories?.includes(category)) &&
    (provision === '' || card.provision === Number(provision)) &&
    (!terms.length || terms.every((term) => normalize(card.name + ' ' + (card.text ?? '')).includes(term))));

  const byName = (a, b) => names.compare(a.name, b.name);
  if (sort === 'name') return shown.sort(byName);
  if (sort === 'power') return shown.sort((a, b) =>
    Number(b.power !== undefined) - Number(a.power !== undefined) ||
    (b.power ?? 0) - (a.power ?? 0) || byName(a, b));
  return shown.sort((a, b) =>
    (a.provision ?? Number.MAX_SAFE_INTEGER) - (b.provision ?? Number.MAX_SAFE_INTEGER) || byName(a, b));
}
