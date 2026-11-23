import { element } from './dom.js?v=opponent-reveal-1';

export const LORE_FACTIONS = Object.freeze({
  protectorate: 'Протекторат',
  growth: 'Поросль',
  neutral: 'Нейтральные',
  captains: 'Вольные капитаны',
  choir: 'Безмолвный хор',
  flawless: 'Безупречные',
  core: 'Ядро',
  void: 'Пустота',
});

export function leagueAvatar(character) {
  const badge = element('span', 'league-avatar', character.initials);
  badge.dataset.loreFaction = character.loreFaction;
  badge.setAttribute('aria-hidden', 'true');
  if (character.avatar) {
    const image = element('img');
    image.alt = '';
    image.addEventListener('load', () => badge.replaceChildren(image), { once: true });
    image.src = './art/' + character.avatar;
  }
  return badge;
}

export function setLeagueSpeech(node, speech) {
  node.textContent = speech ? '«' + speech.line + '»' : '';
  node.classList.toggle('league-telepathy', Boolean(speech?.telepathic));
  node.hidden = !speech;
}

export function leagueCharacter(character, { line, compact = false } = {}) {
  const node = element('div', 'league-character');
  const identity = element('div', 'league-identity');
  const name = element('strong', 'league-name', character.name);
  name.title = character.character;
  identity.append(name);
  if (!compact) identity.append(element('span', 'muted', LORE_FACTIONS[character.loreFaction]));
  const speech = element('blockquote', 'league-speech');
  setLeagueSpeech(speech, line && { line, telepathic: character.telepathic });
  node.append(leagueAvatar(character), identity, speech);
  return node;
}
