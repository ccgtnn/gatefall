import { button, element } from './dom.js?v=step-11';
import { FACTIONS } from '../game/cards.js?v=step-12';
import { addCardCrop } from './cards.js?v=step-12';
import { logView, roundText } from './menu.js?v=step-12';

export function startScreen(phaseLabel, start, stats) {
  phaseLabel.textContent = '';
  const panel = element('section', 'intro');
  const heading = element('h2', null, 'Выбери колоду');
  heading.tabIndex = -1;
  const choices = element('div', 'deck-choices');
  for (const [id, faction] of Object.entries(FACTIONS)) {
    const choice = button(undefined, () => start(id), 'button deck-choice');
    choice.dataset.faction = id;
    const { win, loss } = stats.get(id);
    choice.append(
      element('strong', null, faction.name),
      element('span', 'muted', faction.strategy),
      element('span', null, faction.leader.name),
      element('small', 'deck-record', `Победы ${win} · Поражения ${loss}`),
    );
    addCardCrop(choice, faction.leader);
    choices.append(choice);
  }
  panel.append(heading, choices, element('p', 'muted', 'Бот сыграет второй колодой.'));
  return panel;
}

export function finishedScreen(match, phaseLabel, start, leaveMatch) {
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
  const faction = match.players.human.factionId;
  actions.append(
    button('Ещё раз той же колодой', () => start(faction), 'button primary'),
    button('Выбор колоды', leaveMatch),
  );
  panel.append(
    heading, score,
    ...rounds.map((event) => element('p', 'round-result', roundText(event))),
    actions,
  );
  game.append(panel, logView(match));
  return game;
}
