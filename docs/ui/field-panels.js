import { canUseLeader, leaderCooldown } from '../game/effects/effects.js';
import { totalScore } from '../game/engine/match.js';
import { cardBack } from './card-back.js';
import { cardArt, cardInspection, showCard } from './cards.js';
import { button, element, sideLabel } from './dom.js';

export function createFieldPanels({ humanCanAct, playHuman, showDrawer }) {
  function leaderView(match, side) {
    const player = match.players[side];
    const { leader } = player;
    const panel = element('div', 'field-leader');
    panel.dataset.faction = player.factionId ?? '';
    if (!leader) return panel;
    const portrait = button(undefined, () => showCard({ definition: leader }, { leader: true }), 'leader-portrait');
    portrait.dataset.aimLeader = side;
    portrait.setAttribute('aria-label', 'Лидер · ' + leader.name);
    portrait.title = leader.name;
    if (leader.art) portrait.append(cardArt(leader, 'leader-image'));
    else portrait.append(element('span', 'leader-placeholder', '♜'));
    cardInspection(portrait, { definition: leader }, false, () => showCard({ definition: leader }, { leader: true }));
    panel.append(portrait);
    if (!leader.ability) return panel;
    const cooldown = leaderCooldown(player);
    const showsCharges = !leader.order || leader.order.usesCharges;
    const power = button(showsCharges ? (leader.order ? '⚑ ' : 'ϟ ') + leader.charges : cooldown ? '◷ ' + cooldown : '⚑',
      () => playHuman({ type: 'leader' }), 'leader-power');
    power.title = leader.text;
    const label = showsCharges ? 'зарядов ' + leader.charges : 'Приказ лидера';
    power.setAttribute('aria-label', leader.name + ' · ' + label + (cooldown ? ' · перезарядка: ' + cooldown : ''));
    power.disabled = side !== 'human' || !humanCanAct() || !canUseLeader(match, side);
    panel.append(power);
    return panel;
  }

  function scoreView(match, side) {
    const player = match.players[side];
    const panel = element('div', 'field-score');
    panel.dataset.faction = player.factionId ?? '';
    const points = totalScore(player);
    const total = element('strong', 'field-total', points);
    total.dataset.score = side;
    total.setAttribute('aria-label', sideLabel[side] + ' · сила ' + points);
    const lives = element('span', 'field-lives');
    lives.dataset.lifeSide = side;
    lives.setAttribute('role', 'img');
    lives.setAttribute('aria-label', 'Жизни ' + player.lives + '/2');
    for (let index = 0; index < 2; index += 1) {
      const live = index < player.lives;
      lives.append(element('span', live ? 'life-stone is-live' : 'life-stone', live ? '◆' : '◇'));
    }
    panel.append(element('span', 'field-score-side', sideLabel[side]), total, lives);
    const coins = element('span', 'field-coins');
    coins.dataset.coinsSide = side;
    coins.setAttribute('aria-label', 'Боевые монеты: ' + (player.coins ?? 0));
    const coinIcon = element('span', null, '◉');
    coinIcon.setAttribute('aria-hidden', 'true');
    coins.append(coinIcon, element('strong', null, player.coins ?? 0));
    panel.append(coins);
    if (side === 'bot') {
      const count = element('span', 'field-hand-count bot-hand-count');
      count.classList.toggle('is-passed', player.passed);
      count.title = 'Карт в руке у бота';
      count.setAttribute('role', 'img');
      count.setAttribute('aria-label', 'Карт в руке у бота: ' + player.hand.length);
      count.append(element('span', null, '▯'), element('strong', null, player.hand.length));
      panel.append(count, element('span', 'field-round', 'Раунд ' + match.round));
    }
    if (side === 'human' && player.passed) panel.append(element('span', 'field-passed', 'Пас'));
    return panel;
  }

  function pileView(match, side, pile) {
    const player = match.players[side];
    const count = player[pile].length;
    const name = pile === 'deck' ? 'Колода' : 'Сброс';
    const label = sideLabel[side] + ' · ' + name + ' · ' + count;
    const viewable = pile === 'discard' || side === 'human';
    const node = viewable ? button(undefined, () => showDrawer({ side, pile }), 'field-pile')
      : element('div', 'field-pile');
    node.dataset.faction = player.factionId ?? '';
    node.dataset.pileSide = side;
    node.dataset.pile = pile;
    node.title = label;
    node.setAttribute('aria-label', label);
    node.append(pile === 'deck' ? cardBack(player.factionId, 'pile-card-back') : element('span', 'pile-icon', '▱'),
      element('strong', null, count));
    return node;
  }

  function handSummary(player, side) {
    const human = side === 'human';
    const stack = human
      ? button(undefined, () => showDrawer({ side, pile: 'deck' }), 'field-hand-stack')
      : element('div', 'field-hand-stack');
    const counts = `В руке: ${player.hand.length} · В колоде: ${player.deck.length}`;
    if (human) {
      stack.setAttribute('aria-label', 'Открыть свою колоду. ' + counts);
      stack.title = 'Открыть свою колоду';
    }
    const backs = element('span', 'field-hand-backs');
    backs.setAttribute('aria-hidden', 'true');
    for (let index = 0; index < player.hand.length; index += 1) backs.append(cardBack(player.factionId));
    stack.classList.toggle('is-passed', player.passed);
    const numbers = element('span', 'field-hand-numbers');
    numbers.append(element('span', null, 'В руке: ' + player.hand.length),
      element('span', null, 'В колоде: ' + player.deck.length));
    if (human) stack.append(backs, numbers);
    else stack.append(numbers, backs);
    return stack;
  }

  return { handSummary, leaderView, pileView, scoreView };
}
