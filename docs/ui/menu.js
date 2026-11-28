import { dialogClose } from './resources.js';
import { button, element } from './dom.js';
import { cardArt, cardButton, showCard } from './cards.js';
import { eventText } from './match-log.js';

const CHANGE_LABELS = Object.freeze({
  field: 'поле', handReserve: 'резерв руки', handTempo: 'темп руки', coins: 'монеты',
  armor: 'броня', shields: 'щиты', orders: 'приказы', leaderCharges: 'заряды лидера',
  rowEffects: 'эффекты рядов', delayed: 'отложенные эффекты', carryover: 'перенос',
  lives: 'жизни', outcome: 'исход',
});
const changeNumber = new Intl.NumberFormat('ru', { maximumFractionDigits: 1 });

function formatChanges(changes) {
  return Object.entries(changes ?? {})
    .filter(([key, value]) => Object.hasOwn(CHANGE_LABELS, key) && Number.isFinite(value) && Math.abs(value) >= .05)
    .sort(([, a], [, b]) => Math.abs(b) - Math.abs(a))
    .slice(0, 3)
    .map(([key, value]) => CHANGE_LABELS[key] + ' ' + (value < 0 ? '−' : '+') + changeNumber.format(Math.abs(value)))
    .join(' · ');
}

function botThought(event) {
  const entry = element('li', 'bot-thought');
  entry.append(element('strong', null, 'Бот выбрал «' + event.chosen + '»'), element('p', null, event.reason));
  if (event.candidates.length) {
    const options = element('ol', 'bot-thought-options');
    for (const { label, score, samples, changes } of event.candidates) {
      const estimate = Number.isFinite(score) ? score.toLocaleString('ru', { maximumFractionDigits: 1 }) : '—';
      const option = element('li', null, label + ' · ' + estimate +
        (samples ? ' из 100 (' + samples + ' сим.)' : ''));
      const explanation = formatChanges(changes);
      if (explanation) option.append(element('p', 'muted', explanation));
      options.append(option);
    }
    entry.append(options);
  }
  return entry;
}

export function logView(match, showThoughts = false, testFeedback) {
  const log = element('section', 'panel journal');
  const list = element('ol', 'log-list');
  const ratings = testFeedback?.journalRows();
  for (let index = match.log.length; index > 0; index--) {
    const rows = ratings?.get(index);
    if (rows) list.append(...rows);
    const event = match.log[index - 1];
    if (event.type === 'bot-thought') {
      if (showThoughts) list.append(botThought(event));
    } else {
      const text = eventText(event);
      if (!text) continue;
      const entry = element('li', event.telepathic ? 'league-telepathy' : null, text);
      if (event.type === 'leader-replaced' && event.identityChanged && event.leader.art) {
        const portrait = cardArt(event.leader, 'log-leader-portrait', { staticArt: true, lazyArt: true });
        portrait.width = 26;
        portrait.height = 39;
        entry.prepend(portrait, ' ');
      }
      list.append(entry);
    }
  }
  const initialRows = ratings?.get(0);
  if (initialRows) list.append(...initialRows);
  log.append(element('h2', null, 'Журнал ходов'), list);
  return log;
}

export function createMatchMenu(getMatch, showThoughts, testFeedback) {
  let openPile;
  const drawer = element('dialog', 'field-drawer');
  drawer.setAttribute('aria-labelledby', 'drawer-title');
  drawer.addEventListener('close', () => { if (!drawer.open) openPile = undefined; });
  drawer.addEventListener('click', (event) => {
    if (event.target === drawer) drawer.close();
  });
  document.body.append(drawer);
  function fillDrawer() {
    const match = getMatch();
    const journal = openPile === 'journal';
    const { side, pile } = openPile;
    const player = match.players[side];
    const title = element('h2', null, journal ? 'Журнал ходов'
      : pile === 'deck' ? 'Твоя колода' : 'Сброс · ' + player.faction);
    title.id = 'drawer-title';
    const header = element('header', 'drawer-header');
    header.append(title, dialogClose(drawer));
    if (journal) {
      drawer.replaceChildren(header, logView(match, showThoughts(), testFeedback).querySelector('ol'));
      return;
    }

    const cards = element('div', 'pile-grid');
    const ordered = player[pile].toSorted((left, right) =>
      (right.power ?? 0) - (left.power ?? 0) ||
      left.definition.name.localeCompare(right.definition.name, 'ru'));
    cards.append(...ordered.map((card) => cardButton(card, () => showCard(card), player)));
    if (!ordered.length) cards.append(element('p', 'muted', pile === 'deck' ? 'Колода пуста.' : 'Сброс пуст.'));
    drawer.replaceChildren(header, cards);
  }

  function showDrawer(pile) {
    if (pile.side === 'bot' && pile.pile === 'deck') return;
    openPile = pile;
    drawer.classList.toggle('field-pile-drawer', pile !== 'journal');
    drawer.classList.toggle('field-deck-drawer', pile.pile === 'deck');
    fillDrawer();
    drawer.scrollTop = 0;
    drawer.showModal();
  }

  function refresh(match, replaying) {
    if (!drawer.open || !match) return;
    if (openPile === 'journal') {
      drawer.querySelector('ol').replaceChildren(...logView(match, showThoughts(), testFeedback).querySelector('ol').children);
    } else if (!replaying) {
      fillDrawer();
    }
  }

  return { drawer, refresh, showDrawer };
}
