import { dialogClose } from './resources.js?v=essence-gain-1';
import { button, element } from './dom.js?v=opponent-reveal-1';
import { cardButton, showCard } from './cards.js?v=world-gates-premium-1-nc1';
import { eventText } from './match-log.js';

function botThought(event) {
  const entry = element('li', 'bot-thought');
  entry.append(element('strong', null, 'Бот выбрал «' + event.chosen + '»'), element('p', null, event.reason));
  if (event.candidates.length) {
    const options = element('ol', 'bot-thought-options');
    for (const { label, score, samples } of event.candidates) {
      const estimate = Number.isFinite(score) ? score.toLocaleString('ru', { maximumFractionDigits: 1 }) : '—';
      options.append(element('li', null, label + ' · ' + estimate +
        (samples ? ' из 100 (' + samples + ' сим.)' : '')));
    }
    entry.append(options);
  }
  return entry;
}

export function logView(match, showThoughts = false) {
  const log = element('section', 'panel journal');
  const list = element('ol', 'log-list');
  for (const event of [...match.log].reverse()) {
    if (event.type === 'bot-thought') {
      if (showThoughts) list.append(botThought(event));
    } else {
      const text = eventText(event);
      if (text) list.append(element('li', event.telepathic ? 'league-telepathy' : null, text));
    }
  }
  log.append(element('h2', null, 'Журнал ходов'), list);
  return log;
}

export function createMatchMenu(getMatch, showThoughts) {
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
      drawer.replaceChildren(header, logView(match, showThoughts()).querySelector('ol'));
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
      drawer.querySelector('ol').replaceChildren(...logView(match, showThoughts()).querySelector('ol').children);
    } else if (!replaying) {
      fillDrawer();
    }
  }

  return { drawer, refresh, showDrawer };
}
