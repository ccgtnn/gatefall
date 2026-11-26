import { element } from '../dom.js';
import { fieldSide, fillRowFixture } from './fixtures.js';

export function createRowSection() {
  const section = element('section', 'sandbox-section');
  section.dataset.section = 'row';

  function update(factionId) {
    const { match } = fillRowFixture(factionId);
    const preview = element('div', 'field-center sandbox-row-preview');
    preview.append(fieldSide(match, 'bot'));
    section.replaceChildren(
      element('h2', null, 'Заполненный ряд · Гниение · сторона спасовала'),
      preview,
    );
  }

  return { section, update };
}
