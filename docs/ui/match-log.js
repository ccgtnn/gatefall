import { ROW_LABELS } from '../game/shared/card-metadata.js';
import { ROW_EFFECTS } from '../game/effects/effects.js';
import { sideLabel } from './dom.js';

export function roundText(event) {
  const { scores, winner } = event;
  const outcome = winner === 'human' ? 'твоя победа' : winner === 'bot' ? 'победа бота' : 'ничья';
  return `Раунд ${event.round} · ${outcome} · ${scores.human} : ${scores.bot}`;
}

const passReasons = {
  manual: 'пас',
  'empty-hand': 'автопас, рука пуста',
  'full-row': 'автопас, ряды заполнены',
  'no-target': 'автопас, нет допустимых целей',
};

export function passReasonText(reason) {
  return passReasons[reason] ?? passReasons.manual;
}

export function eventText(event) {
  const side = sideLabel[event.side];
  switch (event.type) {
    case 'league-speech': return `${event.name}: «${event.line}»`;
    case 'mulligan': return `${side}: заменено карт ${event.count}.`;
    case 'round-start': return `Раунд ${event.round}. Первый ход: ${side.toLowerCase()}.`;
    case 'stratagem': return `${side}: на Поверхности появляется стратагема «${event.name}».`;
    case 'play': {
      const origin = event.from === 'deck' ? ' из колоды' : event.from === 'discard' ? ' из сброса' : event.from === 'created' ? ' через Сотворение' : '';
      if (!event.row) return `${side}: «${event.name}» · Эффект${origin}${event.initiative ? ' · Инициатива' : ''}.`;
      return `${side}: «${event.name}» (${event.power ?? 'артефакт'})${origin} → ${ROW_LABELS[event.row]}${event.boardSide ? ' противника' : ''}.`;
    }
    case 'pass': return `${side}: ${passReasonText(event.reason)}.`;
    case 'turn-start': return event.empty ? `${side}: пропускает ход после паса.` : '';
    case 'turn-skip': return `${side}: ход завершён без паса. Нет карты для розыгрыша.`;
    case 'deck-top': return `${side}: карта перемещена на верх колоды.`;
    case 'capture': return `${side}: Захват «${event.name}» в ряд «${ROW_LABELS[event.row]}».`;
    case 'hand-return': return `${side}: карта из руки возвращена в колоду.`;
    case 'hand-bottom': return `${side}: карта из руки перемещена на дно колоды.`;
    case 'coins': return `${side}: монеты ${event.amount > 0 ? '+' : '−'}${Math.abs(event.amount)} · всего ${event.coins}.`;
    case 'transform': return `«${event.name}» превращается в «${event.card.definition.name}».`;
    case 'draw': return `${side}: добор ${event.count}${event.extraSwaps ? ` · дополнительных замен +${event.extraSwaps}` : ''}.`;
    case 'round-end': return roundText(event);
    case 'status': {
      if (event.status === 'shield') return event.count
        ? `«${event.name}»: силовой щит восстановлен.`
        : `«${event.name}»: силовой щит ${event.blockedDamage ? `поглотил ${event.blockedDamage} урона и ` : ''}погас.`;
      if (event.status === 'target') return `«${event.name}»: отмечен Целью.`;
      if (event.status === 'lock') return `«${event.name}»: наложена Блокировка.`;
      if (event.status === 'infection') return event.tick
        ? `«${event.name}»: ${event.blocked ? 'тик Заражения поглощён силовым щитом' : 'Заражение снимает 1 силу'}${event.count ? ' · осталось ' + event.count : ' и заканчивается'}.`
        : `«${event.name}»: Заражение ${event.count}.`;
      return '';
    }
    case 'cleanse': return `«${event.name}»: наложенные эффекты сняты Очищением.`;
    case 'row-effect': return `${side}, ${ROW_LABELS[event.row]}: ${event.effect ? ROW_EFFECTS[event.effect.type]?.label + ' · ' + event.effect.remaining : 'Погода снята'}.`;
    case 'leader-replaced': return `${side}: ${event.name} занимает место лидера.`;
    case 'scenario-chapter': return `«${event.name}»: глава ${event.chapter}.`;
    case 'base-power': return `${side}: базовая сила карты — ${event.basePower}.`;
    case 'heal': return `${side}: сила карты восстановлена до ${event.power}.`;
    case 'order-ready': return event.cooldown
      ? `Приказ карты «${event.name}»: перезарядка сокращена.`
      : `Приказ карты «${event.name}» готов.`;
    case 'armor': return `${side}, «${event.name}»: броня ${event.amount > 0 ? '+' : '−'}${Math.abs(event.amount)}.`;
    case 'boost': return `${side}, «${event.name}»: усиление +${event.amount}.`;
    case 'weaken': return `${side}, «${event.name}»: сила −${event.amount}.`;
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

export function describeMatchAction(match, action, side = 'bot') {
  const { type, row, position } = action;
  const cardId = type === 'place' ? match.pending?.cardId : action.cardId;
  const player = match.players[side];
  const rival = match.players[side === 'bot' ? 'human' : 'bot'];
  const card = cardId && [...(match.pending?.cards ?? []), ...player.hand, ...player.deck, ...player.discard,
    ...Object.values(player.board).flat(), ...Object.values(rival.board).flat(), ...rival.discard]
    .find(({ id }) => id === cardId);
  const name = card?.definition.name ?? ROW_LABELS[cardId] ?? cardId;
  switch (type) {
    case 'pass': return 'Пас';
    case 'end-turn': return 'Конец хода';
    case 'leader': return 'Лидер · ' + player.leader?.name;
    case 'order': return 'Приказ · ' + name;
    case 'fee': return 'Плата · ' + name;
    case 'target': return 'Цель · ' + name;
    case 'play':
    case 'place': return [name, ROW_LABELS[row], position === undefined ? '' : 'позиция ' + (position + 1)]
      .filter(Boolean).join(' · ');
  }
}
