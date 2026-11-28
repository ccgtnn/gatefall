import { button, element } from './dom.js';
import { downloadJson } from './download-json.js';
import { reportFilename, reportJson } from './test-match-report.js';

export function downloadTestReport(report) {
  downloadJson(reportJson(report), reportFilename(report));
}

export function createTestMatchFeedback(report) {
  const download = () => {
    if (report.active) downloadTestReport(report.active);
  };

  function updateRatingButton(node, entry) {
    const stars = entry.rating?.stars;
    const label = stars ? `Изменить оценку хода ${entry.botMove} · ${stars} из 10`
      : `Оценить ход ${entry.botMove}`;
    node.textContent = stars ? `${stars}★` : '💬';
    node.setAttribute('aria-label', label);
    node.title = label;
  }

  function openRating(entry) {
    const dialog = element('dialog', 'panel settings-dialog test-rating-dialog');
    dialog.setAttribute('aria-label', `Оценка хода ${entry.botMove}`);
    const form = element('form', 'test-rating-form');
    const choices = element('fieldset', 'test-rating-stars');
    choices.append(element('legend', null, 'Оценка от 1 до 10'));
    let stars = entry.rating?.stars ?? 0;
    const starButtons = [];
    const save = element('button', 'button primary', 'Сохранить');
    save.type = 'submit';

    function showStars() {
      save.disabled = stars === 0;
      for (const [offset, star] of starButtons.entries()) {
        const value = offset + 1;
        star.setAttribute('aria-pressed', String(value === stars));
        star.classList.toggle('is-selected', value <= stars);
      }
    }

    for (let value = 1; value <= 10; value++) {
      const star = button('★ ' + value, () => { stars = value; showStars(); }, 'button test-rating-star');
      star.setAttribute('aria-label', `${value} из 10`);
      starButtons.push(star);
      choices.append(star);
    }

    const label = element('label', 'test-rating-comment');
    const comment = element('textarea');
    comment.rows = 3;
    comment.value = entry.rating?.comment ?? '';
    label.append(element('span', null, 'Комментарий (необязательно)'), comment);
    const actions = element('div', 'finish-actions');
    actions.append(save, button('Отмена', () => dialog.close()));
    form.append(element('h2', null, `Ход ${entry.botMove} · ${entry.description}`), choices, label, actions);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (report.active?.timeline[entry.index - 1] !== entry) {
        dialog.close();
        return;
      }
      if (!report.rate(entry.index, stars, comment.value)) return;
      for (const node of document.querySelectorAll(`[data-test-rating="${entry.index}"]`)) updateRatingButton(node, entry);
      dialog.close();
    });
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    dialog.append(form);
    showStars();
    document.body.append(dialog);
    dialog.showModal();
  }

  function ratingButton(entry, className) {
    const node = button('', () => openRating(entry), `button test-feedback ${className}`);
    node.dataset.testRating = String(entry.index);
    updateRatingButton(node, entry);
    return node;
  }

  function fieldControls() {
    if (!report.active) return;
    const controls = element('div', 'field-test-controls');
    controls.append(element('span', 'field-test-badge', 'Тест'));
    const move = latestRatingButton('field-test-feedback');
    if (move) controls.append(move);
    return controls;
  }

  function latestRatingButton(className = '') {
    if (report.latestBot) return ratingButton(report.latestBot, className);
  }

  function journalRows() {
    const rows = new Map();
    for (const entry of report.active?.timeline ?? []) {
      if (!entry.botMove) continue;
      const row = element('li', 'test-journal-move');
      row.append(element('span', null, `Ход бота ${entry.botMove} · ${entry.description}`), ratingButton(entry, ''));
      if (!rows.has(entry.logEnd)) rows.set(entry.logEnd, []);
      rows.get(entry.logEnd).unshift(row);
    }
    return rows;
  }

  return { fieldControls, latestRatingButton, journalRows, download, enabled: () => Boolean(report.active) };
}
