import { button, element } from './dom.js?v=step-11';
import { createCard } from '../game/board.js?v=art-24';
import { FACTIONS, NEUTRAL, NEUTRAL_CARDS } from '../game/cards.js?v=art-24';
import { addCardCrop, cardButton, showCard } from './cards.js?v=art-24';
import { logView, roundText } from './menu.js?v=art-24';

export function catalogScreen(phaseLabel, back) {
  phaseLabel.textContent = '';
  const panel = element('section', 'intro card-catalog');
  const heading = element('h2', null, 'Все карты');
  heading.tabIndex = -1;
  const toolbar = element('div', 'catalog-filters');
  const grid = element('div', 'catalog-grid');
  const groups = [[NEUTRAL, 'Нейтральные', NEUTRAL_CARDS], ...Object.entries(FACTIONS)
    .map(([id, faction]) => [id, faction.name, faction.pool])];
  const filters = new Map();

  function select(factionId, definitions) {
    for (const [id, filter] of filters) filter.setAttribute('aria-pressed', String(id === factionId));
    const unique = [...new Map(definitions.map((definition) => [definition.id, definition])).values()];
    grid.replaceChildren(...unique.map((definition) => {
      const card = createCard(definition.id, definition);
      const item = element('div', 'catalog-entry');
      item.append(cardButton(card, () => showCard(card), { factionId }), element('span', null, definition.name));
      return item;
    }));
  }

  for (const [id, name, definitions] of groups) {
    const filter = button(name, () => select(id, definitions));
    filters.set(id, filter);
    toolbar.append(filter);
  }
  select(NEUTRAL, NEUTRAL_CARDS);
  panel.append(heading, toolbar, grid, button('Назад', back));
  return panel;
}

export function leaderScreen(phaseLabel, factionId, start, back) {
  const faction = FACTIONS[factionId];
  phaseLabel.textContent = '';
  const panel = element('section', 'intro');
  const heading = element('h2', null, 'Выбери лидера · ' + faction.name);
  heading.tabIndex = -1;
  const choices = element('div', 'leader-choices');
  for (const leader of faction.leaders) {
    const choice = button(undefined, () => start(factionId, leader.id), 'button leader-choice');
    choice.dataset.faction = factionId;
    if (leader.art) addCardCrop(choice, leader);
    else choice.append(element('span', 'leader-placeholder', '♜'));
    choice.append(element('strong', null, leader.name + ' (+' + leader.provisionBonus + ')'), element('span', 'leader-description', leader.text));
    choices.append(choice);
  }
  panel.append(heading, choices, button('Назад', back));
  return panel;
}

export function finishedScreen(match, phaseLabel, start, leaveMatch, showThoughts) {
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
  actions.append(
    button('Ещё раз той же колодой', start, 'button primary'),
    button('Выбор колоды', leaveMatch),
  );
  panel.append(
    heading, score,
    ...rounds.map((event) => element('p', 'round-result', roundText(event))),
    actions,
  );
  game.append(panel, logView(match, showThoughts));
  return game;
}
