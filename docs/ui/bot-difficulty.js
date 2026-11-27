import { BOT_LEVELS, botLevelLabel, readBotLevel } from '../game/bot/bot-levels.js';
import { element } from './dom.js';

export const BOT_DIFFICULTY_KEY = 'gatefall.bot-difficulty';

export function createBotDifficulty(storage) {
  const changes = new EventTarget();
  let level;

  function refresh() {
    let saved;
    try { saved = storage?.getItem(BOT_DIFFICULTY_KEY); } catch {}
    level = readBotLevel(saved ?? undefined);
    if (saved && saved !== String(level)) {
      try { storage?.setItem(BOT_DIFFICULTY_KEY, String(level)); } catch {}
    }
    changes.dispatchEvent(new Event('change'));
  }

  refresh();
  return {
    read: () => level,
    refresh,
    bind(select, signal) {
      select.replaceChildren(...Object.keys(BOT_LEVELS).map((id) => {
        const option = element('option', null, botLevelLabel(id));
        option.value = id;
        return option;
      }));
      const update = () => { select.value = String(level); };
      update();
      changes.addEventListener('change', update, { signal });
      select.addEventListener('change', () => {
        level = readBotLevel(select.value);
        try { storage?.setItem(BOT_DIFFICULTY_KEY, String(level)); } catch {}
        changes.dispatchEvent(new Event('change'));
      }, { signal });
    },
  };
}
