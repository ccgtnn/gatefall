import assert from 'node:assert/strict';
import test from 'node:test';
import { chooseBotTurn, chooseEasyTurn, pickBotTarget } from '../../docs/game/bot/bot.js';
import { evaluateBreakdown } from '../../docs/game/bot/bot-evaluation.js';
import { damagePoints, effectSwing, rowDamage, rowEffectValue } from '../../docs/game/bot/bot-effect-value.js';
import { preferredLeaderUse } from '../../docs/game/bot/bot-leaders.js';
import { botSearchState } from '../../docs/game/bot/bot-strategy.js';
import { FACTIONS } from '../../docs/game/cards/cards.js';
import { SKARA_REINHOLD } from '../../docs/game/cards/factions/captains.js';
import { TENTACLE } from '../../docs/game/cards/factions/choir.js';
import { DEVOURER_SPAWN } from '../../docs/game/cards/factions/growth.js';
import { ANNIHILATION, NEUTRAL_CARDS } from '../../docs/game/cards/factions/neutral-cards.js';
import { applyAction } from '../../docs/game/engine/match.js';
import { mirrorMatch } from '../../tools/arena-position.mjs';
import { member, pass, plain, position, standard } from '../helpers/bot-strategy.js';

function decide(match, level = 2, options = {}) {
  return chooseBotTurn(match, level, { random: () => .99, rolloutSamples: 0, ...options });
}

test('B1 passes on a secured final round instead of risking Annihilation', () => {
  const match = position(3);
  const { bot, human } = match.players;
  bot.lives = human.lives = 1;
  bot.roundActed = true;
  bot.board.orbit = [plain('bot-ten', 10), plain('nine', 9), plain('two', 2)];
  human.board.orbit = [plain('human-ten-a', 10), plain('human-ten-b', 10)];
  human.passed = true;
  bot.hand = [standard('annihilation', ANNIHILATION)];
  for (let level = 1; level <= 7; level++) assert.deepEqual(decide(match, level), pass, String(level));
});

test('B2 intentional mistakes at levels 3–7 never pass or throw away the match', () => {
  const match = position(2, 'human');
  const { bot, human } = match.players;
  bot.board.orbit = [plain('six', 6)];
  human.board.orbit = [plain('eight', 8)];
  human.passed = true;
  bot.hand = [plain('five', 5), plain('four', 4)];
  for (let level = 3; level <= 7; level++) {
    for (const choice of [0, .5, .99]) {
      const rolls = [0, choice];
      assert.equal(decide(match, level, { random: () => rolls.shift() ?? .99 }).type, 'play', String(level));
    }
  }
  match.round = 3;
  human.lives = 1;
  bot.board.orbit[0].power = 9;
  bot.hand = [member('strike', 'choir', 'mind-strike')];
  const pending = applyAction(match, 'bot', { type: 'play', cardId: 'strike' });
  assert.equal(decide(pending, 3, { random: () => 0 }).cardId, 'eight');
});

test('B3 the R3 mulligan reserves the stronger card after a cheap R2 win', () => {
  const match = position(2, 'human');
  const { bot, human } = match.players;
  bot.deck = human.deck = [];
  human.passed = true;
  human.board.orbit = [plain('lead', 3)];
  bot.hand = [plain('cheap', 5), plain('finisher', 12)];
  const play = (cardId) => applyAction(applyAction(match, 'bot', { type: 'play', cardId, row: 'orbit', position: 0 }), 'bot', pass);
  const cheap = play('cheap');
  const expensive = play('finisher');
  assert.equal(cheap.phase, 'mulligan');
  assert.ok(evaluateBreakdown(cheap, 'bot').parts.handReserve > evaluateBreakdown(expensive, 'bot').parts.handReserve);
});

test('B4 shortfall can be worth paying to stop a growing threat with one life left', () => {
  const match = position(2, 'human');
  const { bot, human } = match.players;
  bot.board.orbit = [plain('anchor', 4)];
  human.board.orbit = [standard('engine', {
    id: 'engine', name: 'Engine', type: 'unit', power: 3,
    endTurn: { steps: [{ action: 'boost', target: { scope: 'source' }, amount: 2 }] },
  })];
  human.hand = Array.from({ length: 4 }, (_, i) => plain('reply-' + i, 5));
  bot.hand = [member('salvo', 'protectorate', 'orbital-salvo'), plain('filler', 1), plain('filler-two', 1)];
  assert.equal(decide(match).cardId, 'salvo');
});

test('B5 the rating of a round-transition draw is independent of deck instance ids', () => {
  const match = position();
  const { bot, human } = match.players;
  human.passed = true;
  bot.board.surface = [plain('lead', 8)];
  bot.deck = [2, 3, 4, 12, 13, 14].map((power, index) => plain('deck-' + index, power));
  const rating = (state) => {
    let report;
    decide(state, 2, { onDecision: (result) => { report = result; } });
    return report.candidates.find(({ action }) => action.type === 'pass').score;
  };
  const before = rating(match);
  bot.deck = bot.deck.map((card, index, deck) => ({ ...card, id: deck[deck.length - index - 1].id }));
  assert.equal(rating(match), before);
});

test('B6 the round-settling simulation aims Mind Strike at the enemy', () => {
  const match = position();
  const { bot, human } = match.players;
  bot.board.surface = [plain('ally', 3)];
  human.board.orbit = [plain('enemy', 6)];
  human.passed = true;
  bot.hand = [member('strike', 'choir', 'mind-strike'), ...[2, 20].map((power) => {
    const id = power === 2 ? 'setup' : 'big';
    return standard(id, { id, name: id, power, requiredRow: 'orbit' });
  })];
  bot.deck = human.deck = [];
  let report;
  decide(match, 2, { onDecision: (result) => { report = result; } });
  const setup = report.candidates.find(({ action }) => action.cardId === 'setup');
  const big = report.candidates.find(({ action }) => action.cardId === 'big');
  assert.ok(setup?.score > big?.score, 'the two-card line wins and retains more points for R2');
});

test('B7 arena mirroring swaps the side that granted a deathwish', () => {
  const match = position();
  const victim = plain('victim', 4);
  victim.owner = 'human';
  victim.inheritedDeathwishes = [{ id: 'mark', grantedBy: 'bot', deathwish: { steps: [] } }];
  match.players.human.board.orbit = [victim];
  const mirrored = mirrorMatch(match).players.bot.board.orbit[0];
  assert.equal(mirrored.owner, 'bot');
  assert.equal(mirrored.inheritedDeathwishes[0].grantedBy, 'human');
  assert.equal(victim.inheritedDeathwishes[0].grantedBy, 'bot');
});

for (const id of ['colossus', 'synaptic-parasite']) {
  test('A1 holds ' + id + ' until an ally enters the field', () => {
    const match = position(3);
    const setup = standard('setup', {
      id: 'setup', name: 'Setup', type: 'unit', rarity: 'bronze', power: 2,
      deathwish: { steps: [{ action: 'spawn', card: { id: 'token', name: 'Token', power: 3 }, row: 'death', amount: 1 }] },
    });
    match.players.bot.hand = [standard(id, FACTIONS.growth.pool.find((card) => card.id === id)), setup];
    assert.equal(decide(match).cardId, setup.id, id);
  });
}

test('A1 saves Helper Robot for a return to deck before the first legendary', () => {
  const match = position(3);
  const robot = NEUTRAL_CARDS.find(({ id }) => id === 'helper-robot');
  const recycle = standard('recycle', {
    id: 'recycle', name: 'Recycle', type: 'unit', power: 3,
    deploy: { steps: [{ action: 'return-hand', amount: 1 }] },
  });
  const legend = standard('legend', { id: 'legend', name: 'Legend', type: 'unit', rarity: 'gold', power: 1 });
  match.players.bot.hand = [standard('robot', robot), recycle, legend];
  match.players.bot.deck = [];
  match.players.human.board.orbit = [plain('opponent', 10)];
  assert.equal(decide(match).cardId, recycle.id);
});

test('A2 Devourer skips its own replacement and chooses a different victim', () => {
  const match = position(3);
  const { bot } = match.players;
  bot.leader = structuredClone(FACTIONS.growth.leaders.find(({ id }) => id === 'devourer'));
  const token = standard('spawn', DEVOURER_SPAWN);
  token.power = 4;
  const ordinary = plain('ordinary', 4);
  bot.board.orbit = [token, ordinary];
  const pending = applyAction(match, 'bot', { type: 'leader' });
  assert.equal(pickBotTarget(pending).cardId, ordinary.id);
  token.statuses = { infection: 1 };
  bot.board.orbit.pop();
  assert.equal(preferredLeaderUse(match, 'bot'), false);
});

test('A3 only allied damage accounts for the tentacle wound reaction', () => {
  const match = position(3);
  const { human } = match.players;
  human.board.orbit = [standard('big-tentacle', { ...TENTACLE, power: 7 })];
  human.board.surface = [plain('other', 6)];
  const hit = member('hit', 'choir', 'mind-strike');
  match.players.bot.hand = [hit];
  const pending = applyAction(match, 'bot', { type: 'play', cardId: hit.id });
  assert.equal(pickBotTarget(pending).cardId, 'big-tentacle');
  assert.equal(rowDamage(human, 'orbit', 1), 1);
  assert.equal(rowDamage(human, 'orbit', 7), 7);
  assert.equal(damagePoints(human.board.orbit[0], 1, undefined, true), -1);
  assert.equal(rowEffectValue(human, 'orbit', 1, true, 1, 'firestorm'), 3);
  const weather = { ...match, pending: {
    kind: 'row-effect', side: 'bot', selectionSide: 'human', rowWeather: 'firestorm',
    options: ['orbit', 'surface'], amount: 1,
  } };
  assert.equal(pickBotTarget(weather).cardId, 'orbit');
  human.board.surface = [];
  assert.equal(effectSwing(match, 'bot', hit), 5);
});

test('A4 a winning Choir banks the round and keeps Abyss Shepherd in reserve', () => {
  const match = position();
  const { bot, human } = match.players;
  bot.board.orbit = [plain('lead', 7)];
  human.board.orbit = [plain('behind', 5)];
  human.passed = true;
  bot.hand = [member('shepherd', 'choir', 'abyss-shepherd'), member('fanatic', 'choir', 'ulmarin-fanatic')];
  const reserve = evaluateBreakdown(match, 'bot').parts.handReserve;
  bot.hand[0] = plain('plain-one', 1);
  assert.ok(reserve - evaluateBreakdown(match, 'bot').parts.handReserve > 2);
  bot.hand[0] = member('shepherd', 'choir', 'abyss-shepherd');
  assert.deepEqual(decide(match, 5), pass);
});

test('T1 the R1 winner keeps pushing a large lead with a cheap card and a strong reserve', () => {
  const match = position(2, 'bot');
  const { bot, human } = match.players;
  bot.deck = human.deck = [];
  bot.board.orbit = [plain('lead', 24)];
  human.board.orbit = [plain('rival', 2)];
  bot.hand = [plain('chip', 2), plain('bank', 8), plain('finisher', 12)];
  human.hand = Array.from({ length: 3 }, (_, index) => plain('defender-' + index, 10));
  human.startingDeck = [...human.hand];
  assert.equal(decide(match, 6).cardId, 'chip');
});

test('T2 spreads the push against live removal and stops discounting a giant once it is spent', () => {
  const match = position(2, 'bot');
  const { bot, human } = match.players;
  const removal = standard('annihilation', ANNIHILATION);
  human.hand = [plain('weak', 3)];
  human.deck = [removal];
  human.startingDeck = [...human.hand, ...human.deck];
  const rating = (powers) => {
    bot.board.orbit = powers.map((power, index) => plain('push-' + index, power));
    return evaluateBreakdown(botSearchState(match, true), 'bot').total;
  };
  assert.ok(rating([7, 7]) > rating([14]));
  match.log.push({ type: 'play', side: 'human', cardId: removal.id, card: removal });
  human.deck = [];
  assert.equal(rating([7, 7]), rating([14]));
});

test('T3 concedes a costly R2 chase with a larger, stronger hand for R3', () => {
  const match = position(2, 'bot');
  const { bot, human } = match.players;
  bot.deck = human.deck = [];
  bot.board.orbit = [plain('lead', 3)];
  human.board.orbit = [plain('rival', 18)];
  bot.hand = [plain('chip', 4), plain('bank', 10), plain('finisher', 12)];
  human.hand = [plain('first', 5), plain('second', 5)];
  human.startingDeck = [...human.hand];
  assert.deepEqual(decide(match, 6), pass);
});

test('Captains use Skara before playing Tiraelis, even near the coin limit', () => {
  const match = position(3);
  const { bot, human } = match.players;
  bot.coins = 8;
  bot.leader = structuredClone(SKARA_REINHOLD);
  bot.hand = [standard('tiraelis', NEUTRAL_CARDS.find(({ id }) => id === 'falura'))];
  human.board.surface = [plain('enemy', 5)];
  human.hand = [];
  human.passed = true;
  bot.lives = human.lives = 1;

  for (let level = 1; level <= 7; level++) assert.deepEqual(decide(match, level), { type: 'leader' }, String(level));
  assert.deepEqual(chooseEasyTurn(match), { type: 'leader' });
  const before = effectSwing(match, 'bot', bot.hand[0]);
  let next = applyAction(match, 'bot', { type: 'leader' });
  next = applyAction(next, 'bot', pickBotTarget(next));
  assert.equal(next.players.bot.leader.charges, 0);
  assert.equal(next.players.bot.coins, 9);
  assert.equal(Object.values(next.players.bot.board).flat().length, 2);
  assert.ok(effectSwing(next, 'bot', bot.hand[0]) > before);
  assert.deepEqual(decide(next), { type: 'play', cardId: 'tiraelis' });
  next = applyAction(next, 'bot', decide(next));
  assert.equal(next.players.bot.leader.name, 'Тираэлис');
});
