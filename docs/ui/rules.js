import { KEYWORDS } from '../game/cards.js?v=step-20';
import { element } from './dom.js?v=step-11';

export function bindRulesMenu() {
  const dialog = document.querySelector('#rules-dialog');
  const glossary = dialog.querySelector('dl');
  for (const [word, meaning] of Object.entries(KEYWORDS)) {
    glossary.append(element('dt', null, word), element('dd', null, meaning));
  }
  document.querySelector('#open-rules').addEventListener('click', () => dialog.showModal());
}
