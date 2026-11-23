import { button, element } from './dom.js?v=opponent-reveal-1';
import { dialogClose } from './resources.js?v=interface-polish-1';
import { leagueAvatar, LORE_FACTIONS, setLeagueSpeech } from './league-character.js?v=league-screen-1';

export const LEAGUE_DIFFICULTY_LABELS = { easy: 'Лёгкий', normal: 'Обычный', hard: 'Сложный' };

export function leagueRecord({ wins = 0, draws = 0, losses = 0 } = {}) {
  return `${wins}–${draws}–${losses}`;
}

export function leagueProfile(bot, score, encounters, play) {
  const dialog = element('dialog', 'panel league-profile');
  const close = dialogClose(dialog, 'league-profile-close');
  close.autofocus = true;
  const title = element('h2', null, bot.name);
  title.id = 'league-profile-title';
  dialog.setAttribute('aria-labelledby', title.id);
  const identity = element('div', 'league-profile-identity');
  identity.append(title, element('p', 'muted', LORE_FACTIONS[bot.loreFaction]),
    element('p', null, bot.character));
  const portrait = element('header', 'league-profile-portrait');
  portrait.append(leagueAvatar(bot), identity);

  const stats = element('dl', 'league-profile-stats');
  const strength = element('span', 'league-strength');
  strength.setAttribute('aria-hidden', 'true');
  strength.append(element('span', null, '★'.repeat(bot.strength)),
    element('span', 'muted', '☆'.repeat(7 - bot.strength)));
  const meetings = (encounters?.wins ?? 0) + (encounters?.draws ?? 0) + (encounters?.losses ?? 0);
  const entries = [
    ['Сила', [strength, ` ${bot.strength}/7`]],
    ['Уровень бота', [LEAGUE_DIFFICULTY_LABELS[bot.difficulty]]],
    ['Колода сейчас', [bot.deck.name]],
    ['Сезон · П–Н–П', [`${leagueRecord(score)} · Очки: ${score.points}`]],
    ['Личные встречи · твои П–Н–П', [`${leagueRecord(encounters)} · Всего: ${meetings}`]],
  ];
  for (const [label, values] of entries) {
    const pair = element('div');
    const value = element('dd');
    value.append(...values);
    pair.append(element('dt', 'muted', label), value);
    stats.append(pair);
  }

  const quotes = Object.values(bot.lines).flat();
  const quote = element('blockquote', 'league-speech');
  setLeagueSpeech(quote, { line: quotes[Math.floor(Math.random() * quotes.length)], telepathic: bot.telepathic });
  dialog.append(close, portrait, stats, quote);
  if (bot.uniqueAbility) {
    const ability = element('section', 'league-ability');
    ability.append(element('h3', null, 'Особая способность · скоро'), element('p', null, bot.uniqueAbility));
    dialog.append(ability);
  }
  if (play) {
    const start = button(play.label, () => {
      dialog.close();
      play.start();
    }, 'button primary');
    start.disabled = play.disabled;
    dialog.append(start);
  }
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  return dialog;
}
