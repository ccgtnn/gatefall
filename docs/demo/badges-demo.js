import { dialogClose } from '../ui/resources.js?v=interface-polish-1';
import { FACTIONS, NEUTRAL_CARDS } from '../game/cards.js?v=helper-robot-1';
import { basePower, createCard, isUnit, statusCount } from '../game/board.js?v=helper-robot-1';
import { cardArt, decorateCard, showCard } from '../ui/cards.js?v=helper-robot-1';
import { button, element, setCardRarity } from '../ui/dom.js?v=opponent-reveal-1';

const svgNamespace = 'http://www.w3.org/2000/svg';
const definitions = [...Object.values(FACTIONS).flatMap(({ pool }) => pool), ...NEUTRAL_CARDS];
const examples = [
  { id: 'infantry', state: 'Обычный отряд' },
  { id: 'bastion', state: 'Легендарный отряд с бронёй и усилением', power: 10 },
  { id: 'liaison', state: 'Повреждение, заражение и счётчик', power: 2, infection: 3, counter: 4 },
  { id: 'commander', state: 'Приказ на перезарядке', cooldown: 2 },
  { id: 'spore-season', state: 'Открыты две главы из трёх', chapter: 2 },
];

function icon(name, width = 40, height = 40) {
  const svg = document.createElementNS(svgNamespace, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(svgNamespace, 'use');
  use.setAttribute('href', './demo/stat-badges.svg?v=3#' + name);
  svg.append(use);
  return svg;
}

function badge(kind, label, value, variant = kind) {
  const node = element('span', 'demo-badge demo-badge-' + kind);
  node.title = label;
  node.setAttribute('aria-label', label);
  node.setAttribute('role', 'img');
  node.append(icon(variant));
  if (value !== undefined) node.append(element('strong', null, value));
  return node;
}

function chapters(played, total) {
  const node = element('span', 'demo-badge demo-badge-chapters');
  node.setAttribute('role', 'img');
  node.title = `Главы сценария: ${played} из ${total}`;
  node.setAttribute('aria-label', node.title);
  for (let index = 0; index < total; index++) {
    node.append(icon(index < played ? 'chapter-filled' : 'chapter-empty', 20, 20));
  }
  return node;
}

function addDemoBadges(face, card, sample, context) {
  const { definition, armor, counter, timer } = card;
  for (const node of face.querySelectorAll('.card-stats, .card-kind, .infection-badge')) node.remove();
  if (definition.order || counter > 0 || timer !== undefined) face.querySelector('.card-state')?.remove();

  if (isUnit(card)) {
    const power = badge('power', `Сила ${card.power}, база ${basePower(card)}`, card.power);
    power.classList.toggle('power-boosted', card.power > basePower(card));
    power.classList.toggle('power-damaged', card.power < basePower(card));
    face.append(power);
  }
  if (armor) face.append(badge('armor', 'Броня ' + armor, armor));
  if ((context === 'catalog' || context === 'preview') && definition.provision !== undefined) {
    face.append(badge('provision', 'Провизия ' + definition.provision, definition.provision));
  }

  if (definition.scenario) face.append(chapters(card.chapter, definition.scenario.chapters.length));
  if (definition.order) face.append(sample.cooldown
    ? badge('order', 'Перезарядка Приказа: ' + sample.cooldown, sample.cooldown, 'order-cooldown')
    : badge('order', 'Приказ готов', undefined, 'order-ready'));
  if (counter > 0 || timer !== undefined) face.append(badge('hourglass',
    (timer === undefined ? 'Счётчик ' : 'Таймер ') + (timer ?? counter), timer ?? counter));
  const infection = statusCount(card, 'infection');
  if (infection) face.append(badge('infection', 'Заражение ' + infection, infection));
}

function oldPreview(card) {
  const face = button(undefined, () => showCard(card, { legacy: true }), 'old-preview-face');
  face.setAttribute('aria-label', card.definition.name + ' · текущий просмотр');
  setCardRarity(face, card.definition.rarity);
  face.append(cardArt(card.definition, 'preview-art'));
  const lines = [];
  if (isUnit(card)) lines.push(card.power === basePower(card) ? `Сила ${card.power}` : `Сила / база ${card.power} / ${basePower(card)}`);
  if (card.armor) lines.push(`Броня ${card.armor}`);
  if (card.counter) lines.push(`Счётчик ${card.counter}`);
  if (card.statuses?.infection) lines.push(`Заражение ${card.statuses.infection}`);
  if (card.definition.scenario) lines.push(`Главы ${card.chapter}/${card.definition.scenario.chapters.length}`);
  const scale = element('div', 'demo-scale demo-preview-current');
  scale.append(face, element('p', 'demo-preview-meta', lines.join(' · ')));
  return scale;
}

function renderCard(card, sample, context, proposed, interactive = true) {
  if (context === 'preview' && !proposed) return oldPreview(card);
  const wrapper = element('div', 'demo-scale');
  const isField = context === 'field';
  const faceClass = isField ? 'unit-face' : 'hand-card';
  const face = interactive
    ? button(undefined, () => proposed ? showProposed(card, sample) : showCard(card, { legacy: true }), faceClass)
    : element('div', faceClass);
  decorateCard(face, card, { factionId: card.definition.faction }, { legacy: true, orderOnField: isField && Boolean(card.definition.order) });
  if (context === 'preview') face.prepend(cardArt(card.definition, 'preview-art'));
  if (context === 'preview') face.querySelector('.card-art-crop')?.remove();
  face.classList.toggle('demo-proposed-face', proposed);
  if (proposed) addDemoBadges(face, card, sample, context);
  wrapper.append(face);
  if (!proposed && isField && sample.cooldown) {
    const order = element('span', 'card-state unit-order order-sleep', sample.cooldown);
    order.title = 'Перезарядка Приказа: ' + sample.cooldown;
    wrapper.append(order);
  }
  return wrapper;
}

const proposedPreview = element('dialog', 'card-preview panel demo-preview-dialog');
proposedPreview.setAttribute('aria-labelledby', 'demo-preview-title');
document.body.append(proposedPreview);

function showProposed(card, sample) {
  const title = element('h2', null, card.definition.name);
  title.id = 'demo-preview-title';
  const close = dialogClose(proposedPreview);
  close.autofocus = true;
  const content = element('div', 'preview-body');
  content.append(title, element('p', null, card.definition.text), close);
  const layout = element('div', 'preview-layout');
  layout.append(renderCard(card, sample, 'preview', true, false), content);
  setCardRarity(proposedPreview, card.definition.rarity);
  proposedPreview.replaceChildren(layout);
  if (!proposedPreview.open) proposedPreview.showModal();
}

function renderExample(sample, middleContext) {
  const definition = definitions.find(({ id }) => id === sample.id);
  const card = createCard(sample.id, definition);
  if (sample.power !== undefined) card.power = sample.power;
  if (sample.counter !== undefined) card.counter = sample.counter;
  if (sample.chapter !== undefined) card.chapter = sample.chapter;
  if (sample.infection) card.statuses = { infection: sample.infection };

  const article = element('article', 'demo-example');
  const header = element('header', 'demo-example-header');
  header.append(element('h2', null, definition.name), element('p', null, sample.state));
  const comparisons = element('div', 'demo-comparisons');
  for (const [context, label] of [['field', 'Поле'], [middleContext, middleContext === 'hand' ? 'Рука' : 'Каталог'], ['preview', 'Крупный просмотр']]) {
    const comparison = element('section', 'demo-comparison');
    comparison.dataset.context = context;
    const pair = element('div', 'demo-pair');
    for (const proposed of [false, true]) {
      const figure = element('figure', proposed ? 'demo-proposed' : 'demo-current');
      figure.append(renderCard(card, sample, context, proposed), element('figcaption', null, proposed ? 'Новые' : 'Сейчас'));
      pair.append(figure);
    }
    comparison.append(element('h3', null, label), pair);
    comparisons.append(comparison);
  }
  article.append(header, comparisons);
  return article;
}

const legend = document.querySelector('.demo-legend');
for (const [label, preview] of [
  ['Сила', badge('power', 'Сила 7', 7)],
  ['Броня', badge('armor', 'Броня 6', 6)],
  ['Провизия', badge('provision', 'Провизия 11', 11)],
  ['Приказ', [badge('order', 'Приказ готов', undefined, 'order-ready'), badge('order', 'Перезарядка Приказа: 2', 2, 'order-cooldown')]],
  ['Таймер / счётчик', badge('hourglass', 'Счётчик 4', 4)],
  ['Заражение', badge('infection', 'Заражение 3', 3)],
  ['Главы', chapters(2, 3)],
]) {
  const cell = element('div', 'demo-key');
  const symbols = element('div', 'demo-key-symbols');
  symbols.append(...[preview].flat());
  cell.append(symbols, element('span', null, label));
  legend.append(cell);
}

const examplesPanel = document.querySelector('.demo-cards');
const context = document.querySelector('#middle-context');
function render() {
  examplesPanel.replaceChildren(...examples.map((sample) => renderExample(sample, context.value)));
}
context.addEventListener('change', render);
render();
