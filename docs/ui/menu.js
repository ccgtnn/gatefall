import { dialogClose } from './resources.js?v=interface-polish-1';
import { button, element, sideLabel } from './dom.js?v=opponent-reveal-1';
import { ROW_LABELS } from '../game/cards.js?v=robot-art-28';
import { cardButton, showCard } from './cards.js?v=hud-raster-1';

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
      const origin = event.from === 'deck' ? ' из колоды' : event.from === 'discard' ? ' из сброса' : '';
      if (!event.row) return `${side}: «${event.name}» · Эффект${origin}${event.initiative ? ' · Инициатива' : ''}.`;
      return `${side}: «${event.name}» (${event.power ?? 'артефакт'})${origin} → ${ROW_LABELS[event.row]}${event.boardSide ? ' противника' : ''}.`;
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
    case 'deck-top': return `${side}: карта перемещена на верх колоды.`;
    case 'draw': return `${side}: добор ${event.count}${event.extraSwaps ? ` · дополнительных замен +${event.extraSwaps}` : ''}.`;
    case 'round-end': return roundText(event);
    case 'status': {
      if (event.status === 'shield') return event.count
        ? `«${event.name}»: силовой щит восстановлен.`
        : `«${event.name}»: силовой щит ${event.blockedDamage ? `поглотил ${event.blockedDamage} урона и ` : ''}погас.`;
      if (event.status === 'target') return `«${event.name}»: отмечен Целью.`;
      if (event.status === 'infection') return event.tick
        ? `«${event.name}»: ${event.blocked ? 'тик Заражения поглощён силовым щитом' : 'Заражение снимает 1 силу'}${event.count ? ' · осталось ' + event.count : ' и заканчивается'}.`
        : `«${event.name}»: Заражение ${event.count}.`;
      return '';
    }
    case 'row-effect': return `${side}, ${ROW_LABELS[event.row]}: ${event.effect ? 'Гниение · ' + event.effect.remaining : 'Гниение снято'}.`;
    case 'leader-replaced': return `${side}: Фалура заменила способность лидера Приказом.`;
    case 'scenario-chapter': return `«${event.name}»: глава ${event.chapter}.`;
    case 'base-power': return `${side}: базовая сила карты — ${event.basePower}.`;
    case 'heal': return `${side}: сила карты восстановлена до ${event.power}.`;
    case 'order-ready': return event.cooldown
      ? `Приказ карты «${event.name}»: перезарядка сокращена.`
      : `Приказ карты «${event.name}» готов.`;
    case 'armor': return `${side}, «${event.name}»: броня ${event.amount > 0 ? '+' : '−'}${Math.abs(event.amount)}.`;
    case 'boost': return `${side}, «${event.name}»: усиление +${event.amount}.`;
    case 'damage': return `${side}, «${event.name}»: урон ${event.amount}, броня поглотила ${event.absorbed}, потеря силы ${event.lost}.`;
    case 'death': return `«${event.name}» погибает и ${event.exile ? 'уходит из игры' : 'попадает в сброс'}.`;
    case 'discard': return `«${event.name}» отправляется в сброс.`;
    case 'destroy': return `Карта «${event.name}» уничтожена и уходит из игры.`;
    case 'consume': return `«${event.eater}» поглощает «${event.name}» (${event.amount} силы).`;
    case 'deathwish': return `Завещание: «${event.name}».`;
    case 'spawn': return event.from === 'deck' ? `${side}: ${ROW_LABELS[event.row]}, призыв «${event.name}» из колоды.`
      : `${side}: ${ROW_LABELS[event.row]}, порождение «${event.name}» ×${event.count}.`;
    case 'leader': return `${side}: ${event.lastUsedTurn === undefined ? 'способность' : 'Приказ'} лидера «${event.name}».`;
    case 'counter': return `Счётчик «${event.name}»: ${event.remaining}.`;
    case 'tick': return 'Таймер «' + event.name + '»: ' + event.remaining + '.';
    case 'order': return `${side}: Приказ карты «${event.name}».`;
  }
}

export function describeBotAction(match, action) {
  const { type, row, position } = action;
  const cardId = type === 'place' ? match.pending?.cardId : action.cardId;
  const { bot, human } = match.players;
  const card = [...bot.hand, ...bot.deck, ...bot.discard, ...Object.values(bot.board).flat(),
    ...Object.values(human.board).flat()].find(({ id }) => id === cardId);
  const name = card?.definition.name ?? ROW_LABELS[cardId] ?? cardId;
  switch (type) {
    case 'pass': return 'Пас';
    case 'end-turn': return 'Конец хода';
    case 'leader': return 'Лидер · ' + bot.leader?.name;
    case 'order': return 'Приказ · ' + name;
    case 'target': return 'Цель · ' + name;
    case 'play':
    case 'place': return [name, ROW_LABELS[row], position === undefined ? '' : 'позиция ' + (position + 1)]
      .filter(Boolean).join(' · ');
  }
}

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
      if (text) list.append(element('li', null, text));
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
    fillDrawer();
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
