import { questComplete, TAVERN_QUEST_BY_ID } from '../game/tavern.js?v=choir-art-6';
import { button, element } from './dom.js?v=opponent-reveal-1';
import { sectionDialog } from './resources.js?v=essence-gain-1';
import { resourceIcon } from './resource-icon.js?v=1';

const rewardLabels = { keys: 'Ключи', gold: 'Золото', steel: 'Сталь' };

export function createTavernScreen(progress) {
  const { dialog, shell } = sectionDialog('tavern-screen', 'Таверна', 'tavern-screen');
  const heading = element('h2', null, 'Таверна');
  const clock = element('p', 'muted tavern-clock');
  const replacement = element('p', 'muted');
  const list = element('div', 'tavern-list');
  const status = element('p', 'economy-status');
  status.setAttribute('role', 'status');
  shell.append(heading, clock, replacement, list, status);
  let state;
  let busy = false;
  let timer;

  function tick() {
    if (!state) return;
    const seconds = Math.max(0, Math.ceil((state.resetAt - Date.now()) / 1000));
    const time = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
      .map((part) => String(part).padStart(2, '0')).join(':');
    clock.textContent = 'Новые задания через ' + time;
  }

  function update() {
    state = progress.tavern();
    if (!state) return;
    tick();
    replacement.textContent = state.replaced ? 'Бесплатная смена использована' : 'Доступна одна бесплатная смена';
    const pending = state.pending.length
      ? [element('h3', 'muted', 'Награды за прошлые дни'), ...state.pending.map(card),
        element('h3', 'muted', 'Сегодняшние задания')]
      : [];
    list.replaceChildren(...pending, ...state.slots.map(card));
  }

  function card(quest) {
    const { title: label, goal, reward } = TAVERN_QUEST_BY_ID.get(quest.id);
    const item = element('article', 'tavern-quest');
    const title = element('h3', null, label);
    const count = element('strong', 'tavern-count', `${quest.progress} / ${goal}`);
    const summary = element('div', 'tavern-summary');
    summary.append(title, count);
    const bar = element('progress');
    bar.max = goal;
    bar.value = quest.progress;
    bar.setAttribute('aria-label', label);
    const actions = element('div', 'tavern-actions');
    const rewards = element('div', 'tavern-rewards');
    for (const [kind, value] of Object.entries(reward)) {
      const token = element('span', null, kind === 'steel' ? `Сталь ${value}` : String(value));
      token.setAttribute('aria-label', `${rewardLabels[kind]} ${value}`);
      if (kind !== 'steel') token.prepend(resourceIcon(kind));
      rewards.append(token);
    }
    actions.append(rewards);
    if (quest.claimed) {
      actions.append(element('span', 'muted', 'Получено'));
    } else if (questComplete(quest)) {
      const accept = button('Забрать', () => run(() => progress.claimTavernQuest(quest.key), 'Награда получена.', quest.key), 'button primary');
      accept.disabled = busy;
      actions.append(accept);
    } else {
      const replace = button('Сменить', () => run(() => progress.changeTavernQuest(quest.key), 'Задание заменено.', quest.key));
      replace.disabled = busy || Boolean(state.replaced);
      actions.append(replace);
    }
    item.dataset.quest = quest.key;
    item.append(summary, bar, actions);
    return item;
  }

  async function run(action, success, key) {
    if (busy) return;
    busy = true;
    const index = [...list.children].findIndex((item) => item.dataset.quest === key);
    update();
    const result = await action();
    if (result === 'stale') await progress.checkpointTavern();
    busy = false;
    update();
    status.textContent = result === 'done' ? success
      : result === 'stale' ? 'Задание обновилось.' : 'Не удалось сохранить изменение.';
    if (dialog.open) (list.children[index]?.querySelector('button:enabled') ?? dialog.querySelector('.section-back')).focus();
  }

  progress.subscribe(() => { if (dialog.open && !busy) update(); });
  dialog.addEventListener('close', () => {
    if (!dialog.open) clearInterval(timer);
  });

  return async () => {
    if (dialog.open) return;
    await progress.checkpointTavern();
    if (dialog.open) return;
    status.textContent = '';
    update();
    dialog.showModal();
    dialog.scrollTop = 0;
    clearInterval(timer);
    timer = setInterval(tick, 1000);
  };
}
