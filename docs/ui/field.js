import { leagueCharacter } from './league-character.js';
import { button, element, iconButton } from './dom.js';
import { playerHand } from './hand.js';
import { availableFees, canUseLeader } from '../game/effects/effects.js';
import { HAND_LIMIT, canEndTurn, canPass } from '../game/engine/match.js';
import { createFieldChoices } from './field-choices.js';
import { createFieldPanels } from './field-panels.js';
import { createFieldRows } from './field-rows.js';
import { cardArt } from './card-art.js';
import { isChoicePending } from './targeting.js';

export function createBattlefield({ getMatch, isReplaying, getSelectedCardId, isMulliganFieldVisible, setMulliganField,
  playHuman, humanCanAct, placeSelected, settingsButton, showDrawer, selectCard, mulliganScreen, getLeagueOpponent, getLeagueSpeech,
  canCancel, cancelTargeting, getTargetAction, choiceLocked, phoneChoice }) {
  const { readyOrderIds, sideView } = createFieldRows({
    getSelectedCardId, humanCanAct, isReplaying, placeSelected, playHuman,
  });
  const { handSummary, leaderView, pileView, scoreView } = createFieldPanels({ humanCanAct, playHuman, showDrawer });
  const { deckChoice, tributeChoice } = createFieldChoices({ playHuman, canCancel, cancelTargeting, getTargetAction, choiceLocked, phoneChoice });

  function battlefield() {
    const match = getMatch();
    const game = element('div', 'match-screen');
    const field = element('div', 'match-board');
    const { pending, players, phase } = match;
    const replaying = isReplaying();
    const humanTurn = phase === 'playing' && !replaying && match.turn === 'human';
    field.classList.toggle('is-human-turn', humanTurn);
    const center = element('div', 'field-center battlefield');
    const humanOrders = readyOrderIds(match, 'human');
    center.append(sideView(match, 'bot', readyOrderIds(match, 'bot')), sideView(match, 'human', humanOrders));
    let choiceOverlay;
    if (!replaying && pending?.side === 'human') {
      if (pending.kind === 'tribute') choiceOverlay = tributeChoice(match);
      else if (isChoicePending(pending)) choiceOverlay = deckChoice(match);
      else {
        const picked = pending.kind === 'deck-placement'
          ? (pending.cards ?? players.human[pending.pile ?? 'deck']).find(({ id }) => id === pending.cardId)
          : undefined;
        const prompt = picked ? picked.definition.name + ' · ' + pending.prompt : pending.prompt;
        const message = element('p', 'field-message target-prompt', prompt);
        if (picked?.definition?.art) message.prepend(cardArt(picked.definition, 'aim-source-art', { staticArt: true }));
        center.append(message);
      }
    }
    const left = element('div', 'field-rail field-left');
    left.append(settingsButton(), pileView(match, 'bot', 'discard'), leaderView(match, 'bot'),
      iconButton('▤', 'Журнал ходов', () => showDrawer('journal'), 'field-log'),
      leaderView(match, 'human'), pileView(match, 'human', 'discard'));
    const right = element('div', 'field-rail field-right');
    const afterPlay = match.turn === 'human' && (match.playedCard || canEndTurn(match, 'human'));
    const action = button(afterPlay ? 'Конец хода' : 'Пас', () =>
      playHuman({ type: afterPlay ? 'end-turn' : 'pass' }), 'button field-action');
    action.id = 'pass-button';
    action.disabled = !humanCanAct() || !(afterPlay ? canEndTurn(match, 'human') : canPass(match, 'human'));
    const ready = !action.disabled && afterPlay ? [
      humanOrders.size && 'Приказ',
      availableFees(match, 'human').length && 'Плата',
      canUseLeader(match, 'human') && 'способность лидера',
    ].filter(Boolean) : [];
    if (ready.length) {
      action.classList.add('has-ready-order');
      action.title = 'Доступно · ' + ready.join(', ');
      action.setAttribute('aria-description', action.title);
    }
    if (humanCanAct() && !afterPlay && players.human.usedAbility) action.title = 'Сыграй карту после применения способности';
    const humanCount = element('span', 'field-hand-count', players.human.hand.length + '/' + HAND_LIMIT);
    humanCount.title = 'Карт в твоей руке';
    const humanCorner = element('div', 'field-corner');
    humanCorner.append(humanCount, pileView(match, 'human', 'deck'));
    const turnControls = element('div', 'field-turn-controls');
    if (phase === 'playing') {
      const label = element('p', 'field-turn-label', match.turn === 'human' ? 'Твой ход' : 'Ход противника');
      label.dataset.side = match.turn;
      if (match.turn === 'bot') {
        const dots = element('span', 'field-thinking-dots');
        dots.setAttribute('aria-hidden', 'true');
        dots.append(element('i'), element('i'), element('i'));
        label.append(dots);
      }
      turnControls.append(label);
    }
    turnControls.append(action);
    const botCorner = pileView(match, 'bot', 'deck');
    botCorner.classList.add('field-compact-count');
    humanCorner.classList.add('field-compact-count');
    const botHand = handSummary(players.bot, 'bot');
    right.append(botCorner, botHand, scoreView(match, 'bot'), turnControls, scoreView(match, 'human'),
      handSummary(players.human, 'human'), humanCorner);
    field.append(left, center, playerHand(match, humanCanAct() && !match.playedCard, selectCard, isReplaying), right);
    const opponent = getLeagueOpponent();
    const stage = opponent ? element('div', 'league-battle-stage') : game;
    if (opponent) {
      game.classList.add('league-battle');
      const speech = getLeagueSpeech();
      const character = leagueCharacter(opponent, { compact: true, line: speech?.line });
      if (speech) {
        // Keep the entrance animation in sync when playback rebuilds the field.
        character.querySelector('.league-speech').style.animationDelay = `${Math.min(0, speech.shownAt - Date.now())}ms`;
      }
      game.append(character, stage);
    }
    stage.append(field);
    if (choiceOverlay) {
      field.inert = true;
      stage.append(choiceOverlay);
    }
    if (phase === 'mulligan') {
      field.inert = !isMulliganFieldVisible();
      stage.append(isMulliganFieldVisible()
        ? button('К муллигану', () => setMulliganField(false), 'button mulligan-return')
        : mulliganScreen());
    }
    const rotate = element('div', 'rotate-notice');
    rotate.append(element('p', null, 'Поверни телефон'), settingsButton());
    game.append(rotate);
    return game;
  }

  return battlefield;
}
