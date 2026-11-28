import { on } from './app-events.js';
import { inspectDeck, PRESETS } from '../game/cards/decks.js';
import { button, element, selectField } from './dom.js';

export const QUICK_MATCH_KEY = 'gatefall.quick-match';

export function quickMatchPanel({ deckStore, inventory, storage, difficulty, play, testReport, downloadReport }, signal) {
  const panel = element('section', 'home-block quick-match');
  const player = selectField('Твоя колода', []);
  const opponent = selectField('Колода бота', []);
  const mastery = selectField('Уровень бота', []);
  difficulty.bind(mastery.input, signal);
  const controls = element('div', 'quick-match-controls');
  const botFields = element('div', 'quick-match-bot');
  botFields.append(opponent.field, mastery.field);
  controls.append(player.field, botFields);

  let playerDecks;
  let botDecks;
  let selected = {};
  try { selected = JSON.parse(storage?.getItem(QUICK_MATCH_KEY)) ?? {}; } catch {}
  const testing = element('input');
  testing.type = 'checkbox';
  testing.checked = selected.testing === true;
  const testLabel = element('label', 'quick-match-testing');
  testLabel.append(testing, 'Тестирование');

  function save() {
    selected = { player: player.input.value, bot: opponent.input.value, ...(testing.checked && { testing: true }) };
    try { storage?.setItem(QUICK_MATCH_KEY, JSON.stringify(selected)); } catch {}
  }

  const start = button('Играть', () => {
    const deck = playerDecks.get(player.input.value);
    if (!deck) return;
    save();
    play(deck, { botDeck: botDecks.get(opponent.input.value), testing: testing.checked });
  }, 'button primary quick-match-play');

  function setOptions(select, choices, selectedId) {
    select.replaceChildren(...choices.map(([id, name]) => {
      const option = element('option', null, name);
      option.value = id;
      return option;
    }));
    select.value = selectedId;
  }

  function update() {
    const { owned } = inventory();
    const userDecks = deckStore.list().filter((deck) => inspectDeck(deck, owned).valid);
    const playerPresets = PRESETS.filter((deck) => inspectDeck(deck, owned).valid);
    const primary = deckStore.primary(owned);
    const available = [...userDecks, ...playerPresets];
    const ordered = primary && available.some(({ id }) => id === primary.id)
      ? [primary, ...available.filter(({ id }) => id !== primary.id)] : available;
    playerDecks = new Map(ordered.map((deck) => [deck.id, deck]));
    botDecks = new Map([...PRESETS.filter((deck) => inspectDeck(deck).valid), ...userDecks]
      .map((deck) => [deck.id, deck]));
    const playerId = playerDecks.has(selected.player) ? selected.player
      : primary && playerDecks.has(primary.id) ? primary.id
        : deckStore.recent(owned).find(({ id }) => playerDecks.has(id))?.id ?? playerPresets[0]?.id ?? userDecks[0]?.id ?? '';
    const botId = botDecks.has(selected.bot) ? selected.bot : '';
    const labels = (entries) => [...entries.values()].map(({ id, name }) => [id, name]);
    setOptions(player.input, playerDecks.size ? labels(playerDecks) : [['', 'Нет играбельных колод']], playerId);
    setOptions(opponent.input, [['', 'Случайная'], ...labels(botDecks)], botId);
    player.input.disabled = start.disabled = !playerDecks.size;
    if ((selected.player && selected.player !== playerId) || (selected.bot && selected.bot !== botId)) save();
  }

  for (const input of [player.input, opponent.input, testing]) input.addEventListener('change', save, { signal });
  on('collection-change', update, { signal });
  update();
  panel.append(element('h2', null, 'Быстрый матч'), controls, testLabel, start);
  const previous = testReport?.previous();
  if (previous) {
    const caption = previous.meta.result ? 'Скачать отчёт прошлого теста' : 'Скачать отчёт прерванного теста';
    panel.append(button(caption, () => downloadReport(previous), 'button quick-match-report'));
  }
  return panel;
}
