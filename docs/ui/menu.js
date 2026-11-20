import { button, element, sideLabel } from './dom.js?v=step-11';
import { ROW_LABELS } from '../game/cards.js?v=step-12';
import { cardButton, showCard } from './cards.js?v=step-12';

export function roundText(event) {
  const { scores, winner } = event;
  const outcome = winner === 'human' ? 'твоя победа' : winner === 'bot' ? 'победа бота' : 'ничья';
  return `Раунд ${event.round} · ${outcome} · ${scores.human} : ${scores.bot}`;
}

export function eventText(event) {
  const side = sideLabel[event.side];
  switch (event.type) {
    case 'mulligan': return `${side}: заменено карт ${event.count}.`;
    case 'round-start': return `Раунд ${event.round}. Первый ход: ${side.toLowerCase()}.`;
    case 'stratagem': return `${side}: на Поверхности появляется стратагема «${event.name}».`;
    case 'play': {
      if (!event.row) return `${side}: «${event.name}» · Эффект.`;
      return `${side}: «${event.name}» (${event.power ?? 'артефакт'})${event.from === 'deck' ? ' из колоды' : ''} → ${ROW_LABELS[event.row]}.`;
    }
    case 'pass': {
      const reasons = {
        manual: 'пас',
        'empty-hand': 'автопас, рука пуста',
        'full-row': 'автопас, ряды заполнены',
        'no-target': 'автопас, нет допустимых целей',
      };
      return `${side}: ${reasons[event.reason]}.`;
    }
    case 'turn-skip': return `${side}: ход завершён без паса. Нет карты для розыгрыша.`;
    case 'draw': return `${side}: добор ${event.count}${event.extraSwaps ? ` · дополнительных замен +${event.extraSwaps}` : ''}.`;
    case 'round-end': return roundText(event);
    case 'armor': return `${side}, «${event.name}»: броня ${event.amount > 0 ? '+' : '−'}${Math.abs(event.amount)}.`;
    case 'boost': return `${side}, «${event.name}»: усиление +${event.amount}.`;
    case 'damage': return `${side}, «${event.name}»: урон ${event.amount}, броня поглотила ${event.absorbed}, потеря силы ${event.lost}.`;
    case 'death': return `«${event.name}» погибает и ${event.exile ? 'уходит из игры' : 'попадает в сброс'}.`;
    case 'destroy': return `Карта «${event.name}» уничтожена и уходит из игры.`;
    case 'consume': return `«${event.eater}» поглощает «${event.name}» (${event.amount} силы).`;
    case 'deathwish': return `Завещание: «${event.name}».`;
    case 'spawn': return `${side}: ${ROW_LABELS[event.row]}, порождение «${event.name}» ×${event.count}.`;
    case 'leader': return `${side}: способность лидера «${event.name}».`;
    case 'tick': return 'Таймер «' + event.name + '»: ' + event.remaining + '.';
    case 'order': return `${side}: Приказ карты «${event.name}».`;
  }
}

export function logView(match) {
  const log = element('section', 'panel journal');
  const list = element('ol', 'log-list');
  for (const event of [...match.log].reverse()) {
    list.append(element('li', null, eventText(event)));
  }
  log.append(element('h2', null, 'Журнал ходов'), list);
  return log;
}

export function createMatchMenu(getMatch) {
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
    header.append(title, button('Закрыть', () => drawer.close()));
    if (journal) {
      drawer.replaceChildren(header, logView(match).querySelector('ol'));
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
    fillDrawer();
    drawer.showModal();
  }

  function refresh(match, replaying) {
    if (!drawer.open || !match) return;
    if (openPile === 'journal') {
      drawer.querySelector('ol').replaceChildren(...logView(match).querySelector('ol').children);
    } else if (!replaying) {
      fillDrawer();
    }
  }

  return { drawer, refresh, showDrawer };
}
