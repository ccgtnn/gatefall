import { leagueCharacter } from './league-character.js';
import { button, element } from './dom.js';
import { FACTIONS } from '../game/cards.js';
import { addCardCrop } from './cards.js';
import { logView } from './menu.js';
import { roundText } from './match-log.js';
import { sectionBack } from './resources.js';

export function leaderScreen(phaseLabel, factionId, start, back) {
  const faction = FACTIONS[factionId];
  phaseLabel.textContent = '';
  const panel = element('section', 'intro');
  panel.setAttribute('aria-label', 'Выбери лидера · ' + faction.name);
  const choices = element('div', 'leader-choices');
  for (const leader of faction.leaders) {
    const choice = button(undefined, () => start(factionId, leader.id), 'button leader-choice');
    choice.dataset.faction = factionId;
    if (leader.art) addCardCrop(choice, leader);
    else choice.append(element('span', 'leader-placeholder', '♜'));
    choice.append(element('strong', null, leader.name + ' (+' + leader.provisionBonus + ')'), element('span', 'leader-description', leader.text));
    choices.append(choice);
  }
  panel.append(sectionBack(back), choices);
  return panel;
}

export function finishedScreen(match, phaseLabel, start, leaveMatch, showThoughts, canReplay, league, { saving, failed, notice, opponent, reply }) {
  phaseLabel.textContent = `Матч завершён · раундов ${match.round}`;
  const game = element('div', 'game');
  const panel = element('section', 'panel finish');
  const outcomes = { win: 'Победа', loss: 'Поражение', draw: 'Ничья' };
  const heading = element('h2', null, outcomes[match.result]);
  heading.tabIndex = -1;
  const rounds = match.log.filter((event) => event.type === 'round-end');
  const wins = rounds.filter(({ winner }) => winner === 'human').length;
  const losses = rounds.filter(({ winner }) => winner === 'bot').length;
  const ties = rounds.length - wins - losses;
  const score = element('p', 'match-result-score', `Раунды · Ты ${wins} : ${losses} Противник${ties ? ' · Ничьих: ' + ties : ''}`);
  const actions = element('div', 'finish-actions');
  const replay = button('Ещё раз той же колодой', start, 'button primary');
  const missing = element('p', 'deck-invalid', 'В коллекции отсутствуют копии для этой колоды.');
  function updateReplay() {
    const playable = canReplay();
    replay.disabled = saving || failed || !playable;
    missing.hidden = playable || saving;
  }
  panel.addEventListener('collection-change', updateReplay);
  updateReplay();
  if (failed) {
    actions.append(button('Повторить сохранение', leaveMatch, 'button primary'));
  } else {
    if (!league) actions.append(replay);
    const back = button(league ? 'К таблице лиги' : 'Выбор колоды', leaveMatch, league ? 'button primary' : 'button');
    back.disabled = saving;
    actions.append(back);
  }
  panel.append(heading, score,
    ...rounds.map((event) => element('p', 'round-result', roundText(event))));
  if (opponent) panel.append(leagueCharacter(opponent, { line: reply?.line }));
  if (notice) panel.append(element('p', 'muted', notice));
  if (!league && !failed) panel.append(missing);
  panel.append(actions);
  game.append(panel, logView(match, showThoughts));
  return game;
}
