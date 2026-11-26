import { botLevelLabel } from '../game/bot-levels.js';
import { leagueStake } from '../game/league.js';
import { leagueAvatar, setLeagueSpeech } from './league-character.js';
import { leagueIdentity } from './league-standings.js';
import { button, element, selectField } from './dom.js';

export function nextOpponent(bot, { active, season, league, ticket, actions, busy, submit, openProfile,
  selectedDeck, setSelectedDeck }) {
  const opponent = element('section', 'league-opponent');
  const label = active ? 'Незавершённый матч' : 'Следующий соперник';
  const challenger = button(undefined, () => openProfile(bot, season.scores[bot.id]), 'league-challenger');
  challenger.setAttribute('aria-haspopup', 'dialog');
  challenger.append(leagueAvatar(bot), leagueIdentity(bot));
  const greeting = element('blockquote', 'league-speech');
  setLeagueSpeech(greeting, { line: bot.lines.start[0], telepathic: bot.telepathic });
  const details = element('div', 'league-opponent-details');
  const identity = element('div', 'league-opponent-summary');
  identity.append(challenger,
    element('p', 'muted league-opponent-info', `${bot.deck.name} · ${botLevelLabel(bot.level)}`));
  details.append(identity, greeting);
  const controls = element('div', 'league-opponent-controls');
  opponent.append(element('h3', null, label), details, controls);
  let currentPlay;
  if (active) {
    const concede = button('Засчитать поражение', () => submit(() => actions.concede(active.id)));
    concede.disabled = busy.active;
    controls.append(concede);
  } else {
    const decks = actions.decks();
    const picker = selectField('Твоя колода', decks.length
      ? decks.map(({ id, name }) => [id, name]) : [['', 'Нет играбельных колод']]);
    if (decks.some(({ id }) => id === selectedDeck)) picker.input.value = selectedDeck;
    picker.input.addEventListener('change', () => { setSelectedDeck(picker.input.value); });
    const stake = leagueStake(league);
    const short = actions.gold() < stake;
    currentPlay = {
      label: stake ? `Играть против него · ${stake} золота` : 'Играть против него',
      disabled: busy.active || short || !decks.length,
      start: () => submit(() => actions.play(ticket, bot, decks.find(({ id }) => id === picker.input.value))),
    };
    const start = button(stake ? `Играть матч · ${stake} золота` : 'Играть матч', currentPlay.start, 'button primary');
    start.disabled = currentPlay.disabled;
    picker.input.disabled = busy.active || !decks.length;
    controls.append(picker.field, start);
    if (short) controls.append(element('p', 'muted', 'Не хватает золота на ставку.'));
  }
  return { opponent, currentPlay };
}
