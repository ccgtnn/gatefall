import { KEYWORDS } from '../game/cards.js?v=epic-golems-1';
import { element } from './dom.js?v=opponent-reveal-1';

export function bindRulesMenu() {
  const dialog = document.querySelector('#rules-dialog');
  const glossary = dialog.querySelector('dl');
  for (const [word, meaning] of Object.entries(KEYWORDS)) {
    glossary.append(element('dt', null, word), element('dd', null, meaning));
  }
  document.querySelector('#open-rules').addEventListener('click', () => dialog.showModal());
}
