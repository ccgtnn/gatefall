import test from 'node:test';
import assert from 'node:assert/strict';
import { statSync } from 'node:fs';
import { inspectDeck } from '../../docs/game/cards/decks.js';
import { FACTIONS } from '../../docs/game/cards/cards.js';
import { FACTION_CATALOG, UPCOMING_FACTIONS } from '../../docs/game/cards/faction-catalog.js';
import { LEAGUE_CHARACTERS } from '../../docs/game/meta/data/league-characters.js';
import { LEAGUE_CONTEXT_LINES } from '../../docs/game/meta/data/league-context-lines.js';
import { leagueDeckFor } from '../../docs/game/meta/league-decks.js';
import { createLeagueDialogue, pickLeagueLine } from '../../docs/game/meta/league-dialogue.js';
import { leagueRecord, leagueRoundRecord } from '../../docs/ui/league-profile.js';
import {
  createLeague, finishLeagueMatch, LEAGUES, leagueSchedule, leagueTicket, reserveLeagueMatch,
} from '../../docs/game/meta/league.js';

const reasons = ['start', 'botStrong', 'humanStrong', 'roundWin', 'roundLoss', 'pass', 'win', 'loss'];
const telepath = LEAGUE_CHARACTERS.find(({ name }) => name === 'Первый Голос');
const zero = () => 0;

test('the renamed league rival retains his saved ID and contextual lines', () => {
  const rival = LEAGUE_CHARACTERS.find(({ id }) => id === 'bot-2-1');
  assert.equal(rival.name, 'Гаррет Шрайк');
  assert.equal(rival.initials, 'ГШ');
  assert.equal(rival.avatar, 'league/garrett-shrike.webp');
  assert.ok(LEAGUE_CONTEXT_LINES[rival.id]);
});

test('league records display match results and the separate round totals', () => {
  assert.equal(leagueRecord({ wins: 3, draws: 2, losses: 1, difference: 4 }), 'В 3 · Н 2 · П 1');
  assert.equal(leagueRecord({ wins: 1 }), 'В 1 · Н 0 · П 0');
  assert.equal(leagueRoundRecord({ roundsWon: 0, roundsLost: 0 }), '0–0');
  assert.equal(leagueRoundRecord({ roundsWon: 8, roundsLost: 4 }), '8–4');
  assert.equal(leagueRoundRecord({ difference: 4 }), '—');
});

test('all 31 characters have ranked places, eight occasions, and legal decks', () => {
  assert.equal(LEAGUE_CHARACTERS.length, 31);
  assert.equal(new Set(LEAGUE_CHARACTERS.map(({ id }) => id)).size, 31);
  assert.deepEqual(LEAGUE_CHARACTERS.filter(({ telepathic }) => telepathic).map(({ name }) => name),
    ['Сестра Безмолвие', 'Первый Голос']);
  for (const [tier, { bots }] of LEAGUES.entries()) {
    assert.deepEqual(bots.map(({ strength }) => strength).sort(), Array.from({ length: tier ? 8 : 7 }, (_, i) => i + 1));
    for (const bot of bots) {
      assert.ok(bot.name && bot.character && bot.initials);
      assert.equal(bot.strengthScale, bots.length);
      assert.equal(Boolean(bot.uniqueAbility), tier === 3);
      assert.deepEqual(Object.keys(bot.lines), reasons);
      assert.ok(Object.values(bot.lines).every((lines) => new Set(lines).size === 2));
      assert.ok(inspectDeck(bot.deck).valid, bot.name);
    }
    const levels = bots.toSorted((a, b) => a.strength - b.strength).map((bot) => bot.level);
    assert.deepEqual(levels, [
      [1, 1, 1, 2, 2, 3, 3], [2, 2, 2, 3, 3, 3, 4, 4],
      [4, 4, 4, 5, 5, 5, 6, 6], [5, 5, 5, 6, 6, 6, 7, 7],
    ][tier]);
  }
});

test('every league deck has valid replacements at actual card positions', () => {
  const decks = new Set(LEAGUE_CHARACTERS.map((character) => leagueDeckFor(character)));
  for (const { id, cardIds, ...deck } of decks) {
    assert.equal(Object.hasOwn(cardIds, '-1'), false, id);
    assert.ok(inspectDeck({ id, cardIds, ...deck }).valid, id);
  }
});

test('every league character has a portrait file', () => {
  const art = new URL('../../docs/art/', import.meta.url);
  for (const { name, avatar } of LEAGUE_CHARACTERS) {
    assert.ok(avatar, `${name} has no avatar`);
    assert.ok(statSync(new URL(avatar, art), { throwIfNoEntry: false })?.isFile(),
      `${name} avatar file is missing: ${avatar}`);
  }
});

test('the faction catalog starts with playable factions and covers the league characters', () => {
  const playable = Object.keys(FACTIONS);
  assert.deepEqual(Object.keys(FACTION_CATALOG).slice(0, playable.length), playable);
  for (const id of playable) assert.ok(!Object.hasOwn(UPCOMING_FACTIONS, id), id);
  assert.ok(!Object.hasOwn(FACTION_CATALOG, 'core'));
  for (const { name, loreFaction } of LEAGUE_CHARACTERS) {
    if (loreFaction !== 'neutral') {
      assert.ok(Object.hasOwn(FACTION_CATALOG, loreFaction), `${name}: missing faction ${loreFaction}`);
    }
  }
});

test('Captains and Choir use their faction presets, while future factions use temporary decks', () => {
  for (const loreFaction of ['captains', 'choir', 'flawless', 'void']) {
    const deck = { factionId: loreFaction };
    const bots = LEAGUE_CHARACTERS.filter((character) => character.loreFaction === loreFaction);
    assert.ok(bots.length);
    for (const character of bots) {
      const fallback = leagueDeckFor(character);
      if (['captains', 'choir'].includes(loreFaction)) {
        assert.equal(fallback.id, 'preset-' + loreFaction, character.name);
        assert.equal(fallback.factionId, loreFaction);
      } else {
        assert.equal(fallback.factionId, character.id === 'frontier-rookie-2' ? 'growth' : 'protectorate');
      }
      assert.equal(leagueDeckFor(character, { [loreFaction]: deck }), deck);
      if (character.id === 'bot-3-6') assert.ok(fallback.cardIds.includes('falura'));
    }
  }
  const mira = LEAGUE_CHARACTERS.find(({ name }) => name === 'Доктор Мира Холт');
  assert.equal(mira.loreFaction, 'neutral');
  assert.equal(leagueDeckFor(mira).factionId, 'growth');
});

test('simulated results favor the higher ranked opponent when the random rolls cancel', () => {
  const league = createLeague(Date.UTC(2026, 10, 23));
  reserveLeagueMatch(league, leagueTicket(league), 'first', 0);
  finishLeagueMatch(league, 'first', 'draw', 0, zero);
  const strengths = new Map(LEAGUES[0].bots.map(({ id, strength }) => [id, strength]));
  for (const pair of leagueSchedule(league.season)[0].slice(1)) {
    const [winner, loser] = pair.sort((a, b) => strengths.get(b) - strengths.get(a));
    assert.equal(league.season.scores[winner].wins, 1);
    assert.equal(league.season.scores[loser].losses, 1);
  }
});

test('lines match their reason, skip the previous line, and use a 35 percent optional threshold', () => {
  for (const reason of reasons) {
    const [first, second] = telepath.lines[reason];
    assert.equal(pickLeagueLine(telepath, reason, undefined, zero), first);
    assert.equal(pickLeagueLine(telepath, reason, first, zero), second);
  }
  assert.equal(pickLeagueLine(telepath, 'pass', undefined, () => .349), telepath.lines.pass[0]);
  assert.equal(pickLeagueLine(telepath, 'pass', undefined, () => .35), null);
  for (const reason of ['start', 'win', 'loss']) {
    assert.equal(pickLeagueLine(telepath, reason, undefined, () => .99), telepath.lines[reason][1]);
  }
});

test('all 31 league characters have lines for all five opening contexts', () => {
  const contexts = ['gloat', 'promoted', 'relegated', 'respect', 'revenge'];
  assert.equal(Object.keys(LEAGUE_CONTEXT_LINES).length, 31);
  for (const { id } of LEAGUE_CHARACTERS) {
    const lines = LEAGUE_CONTEXT_LINES[id];
    assert.deepEqual(Object.keys(lines).sort(), contexts, id);
    for (const context of contexts) {
      assert.ok(lines[context].length > 0 && lines[context].every((line) => typeof line === 'string' && line.trim()), id);
    }
  }
});

test('arrival takes priority in the first meeting, then respect and the last player result', () => {
  const { id } = telepath;
  const league = {
    season: { round: 0, arrivals: { [id]: 1 }, scores: { human: {}, [id]: {} } },
    encounters: { [id]: { wins: 3, last: 'loss' } },
  };
  const start = (random = zero) => createLeagueDialogue(telepath, random).start(league);
  const promoted = start();
  assert.equal(promoted.reason, 'promoted');
  assert.equal(promoted.line, LEAGUE_CONTEXT_LINES[id].promoted[0]);
  assert.equal(promoted.telepathic, true);
  assert.equal(start(() => .699).reason, 'promoted');
  assert.equal(start(() => .7).reason, 'start');

  league.season.arrivals[id] = -1;
  assert.equal(start().reason, 'relegated');
  league.season.round = 1;
  assert.equal(start().reason, 'respect');

  league.encounters[id].wins = 2;
  assert.equal(start().reason, 'gloat');
  league.encounters[id].last = 'win';
  assert.equal(start().reason, 'revenge');
  league.encounters[id].last = 'draw';
  assert.equal(start().reason, 'start');
  delete league.encounters[id].last;
  delete league.season.arrivals;
  assert.equal(start().reason, 'start');
  league.encounters[id].wins = 3;
  assert.equal(start().reason, 'respect');
});

function scenario(humanPower = 0, botPower = 0, turns = 0) {
  const player = (power, played) => ({ board: { orbit: [{ power }], surface: [] }, turns: played });
  return { phase: 'playing', players: { human: player(humanPower, turns), bot: player(botPower, 0) } };
}

const play = (side, rarity = 'bronze') => ({ type: 'play', side, card: { definition: { rarity } } });

test('strong plays count score swings and rarity, with one optional line per turn', () => {
  const dialogue = createLeagueDialogue(telepath, zero);
  assert.equal(dialogue.start().telepathic, true);
  assert.equal(dialogue.transition(scenario(), scenario(5), [play('human')]), null);
  assert.equal(dialogue.transition(scenario(), scenario(2, 8), [play('bot')]).reason, 'botStrong');
  assert.equal(dialogue.transition(scenario(), scenario(9), [play('human', 'gold')]), null);
  assert.equal(dialogue.transition(scenario(0, 0, 1), scenario(1), [play('human', 'gold')]).reason, 'humanStrong');
  assert.equal(dialogue.transition(scenario(0, 0, 2), scenario(), [play('bot', 'epic')]).reason, 'botStrong');
});

test('targeted plays wait for resolution and cancelled plays do not leave stale dialogue', () => {
  const dialogue = createLeagueDialogue(telepath, zero);
  const pending = { ...scenario(2), pending: { side: 'human' } };
  assert.equal(dialogue.transition(scenario(), pending, [play('human')]), null);
  assert.equal(dialogue.transition(pending, scenario(6), []).reason, 'humanStrong');
  assert.equal(dialogue.transition(scenario(0, 0, 1), pending, [play('human', 'gold')]), null);
  dialogue.cancelPlay();
  assert.equal(dialogue.transition(scenario(0, 0, 1), scenario(3), [play('human')]), null);
});

test('round, pass and match outcomes use the opponent perspective', () => {
  const dialogue = createLeagueDialogue(telepath, zero);
  const round = (winner) => ({ type: 'round-end', winner, scores: { bot: 1, human: 2 } });
  assert.equal(dialogue.transition(scenario(), scenario(), [round('human')]).reason, 'roundLoss');
  assert.equal(dialogue.transition(scenario(0, 0, 1), scenario(), [round('bot')]).reason, 'roundWin');
  const pass = { type: 'pass', side: 'bot' };
  const firstPass = dialogue.transition(scenario(0, 0, 2), scenario(), [pass]);
  assert.equal(firstPass.reason, 'pass');
  assert.notEqual(dialogue.transition(scenario(0, 0, 3), scenario(), [pass]).line, firstPass.line);
  assert.equal(dialogue.transition(scenario(), { ...scenario(), phase: 'finished', result: 'win' }, [round('human')]).reason, 'loss');
  assert.equal(dialogue.transition(scenario(), { ...scenario(), phase: 'finished', result: 'loss' }, [round('bot')]).reason, 'win');
});
