import { dialogClose } from './resources.js';
import { KEYWORDS } from '../game/cards.js';
import { element } from './dom.js';

export function bindRulesMenu() {
  const dialog = document.querySelector('#rules-dialog');
  dialog.querySelector('.drawer-header').append(dialogClose(dialog));
  const glossary = dialog.querySelector('dl');
  for (const [word, meaning] of Object.entries(KEYWORDS)) {
    glossary.append(element('dt', null, word), element('dd', null, meaning));
  }
  document.querySelector('#open-rules').addEventListener('click', () => dialog.showModal());
}
