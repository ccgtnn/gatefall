import { bindRulesMenu } from './rules.js?v=falura-art-1';
import { createSoundEffects, DEFAULT_VOLUME } from '../sound.js?v=step-10-volume';
import { motionDuration } from '../turn-playback.js?v=falura-art-1';

export function createSettings(app, onLeave) {
  const settings = document.querySelector('#settings');
  const matchMenu = document.querySelector('#match-menu');
  const leaveDialog = document.querySelector('#leave-match');
  const fullscreenButton = document.querySelector('#fullscreen');
  const fullscreenStatus = document.querySelector('#fullscreen-status');
  const fullscreenMode = matchMedia('(display-mode: fullscreen)');
  const difficultySetting = document.querySelector('#bot-difficulty');
  const difficultyKey = 'gatefall.bot-difficulty';
  try {
    const saved = localStorage.getItem(difficultyKey);
    if (['easy', 'normal', 'hard'].includes(saved)) difficultySetting.value = saved;
  } catch {}
  difficultySetting.addEventListener('change', () => {
    try { localStorage.setItem(difficultyKey, difficultySetting.value); } catch {}
  });
  const thoughts = document.querySelector('#bot-thoughts');
  const thoughtsKey = 'gatefall.bot-thoughts';
  try { thoughts.checked = localStorage.getItem(thoughtsKey) === 'on'; } catch {}
  thoughts.addEventListener('change', () => {
    try { localStorage.setItem(thoughtsKey, thoughts.checked ? 'on' : 'off'); } catch {}
  });
  bindRulesMenu();
  const speedSetting = document.querySelector('#animation-speed');
  const systemSpeed = speedSetting.querySelector('[value="system"]');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const speedKey = 'gatefall.animation-speed';
  try {
    const saved = localStorage.getItem(speedKey);
    if (saved === 'normal' || saved === 'fast') speedSetting.value = saved;
  } catch {}
  app.dataset.animationSpeed = speedSetting.value;
  speedSetting.addEventListener('change', () => {
    app.dataset.animationSpeed = speedSetting.value;
    try { localStorage.setItem(speedKey, speedSetting.value); } catch {}
  });

  const soundSetting = document.querySelector('#sound-enabled');
  const volumeSetting = document.querySelector('#sound-volume');
  const volumeLabel = document.querySelector('#sound-level');
  const soundTest = document.querySelector('#sound-test');
  const soundKey = 'gatefall.sound-enabled';
  const volumeKey = 'gatefall.sound-volume';
  volumeSetting.value = DEFAULT_VOLUME * 100;
  try {
    soundSetting.checked = localStorage.getItem(soundKey) !== 'off';
    const saved = localStorage.getItem(volumeKey);
    if (saved !== null && Number.isFinite(Number(saved))) volumeSetting.value = saved;
  } catch {}

  const sounds = createSoundEffects(soundSetting.checked, undefined, Number(volumeSetting.value) / 100);
  function syncSoundControls() {
    volumeLabel.value = volumeSetting.value + '%';
    soundTest.disabled = !soundSetting.checked || Number(volumeSetting.value) === 0;
  }
  syncSoundControls();

  soundSetting.addEventListener('change', () => {
    sounds.setEnabled(soundSetting.checked);
    if (soundSetting.checked) sounds.unlock();
    syncSoundControls();
    try { localStorage.setItem(soundKey, soundSetting.checked ? 'on' : 'off'); } catch {}
  });
  volumeSetting.addEventListener('input', () => {
    sounds.setVolume(Number(volumeSetting.value) / 100);
    syncSoundControls();
    try { localStorage.setItem(volumeKey, volumeSetting.value); } catch {}
  });
  soundTest.addEventListener('click', sounds.testSound);
  for (const type of ['pointerdown', 'pointerup', 'keydown']) {
    document.addEventListener(type, sounds.unlock, { capture: true, passive: true });
  }

  function updateSystemSpeed() {
    systemSpeed.textContent = reducedMotion.matches ? 'По системе (выключены)' : 'По системе (обычная)';
  }

  reducedMotion.addEventListener('change', updateSystemSpeed);
  updateSystemSpeed();

  function syncFullscreen() {
    const installedFullscreen = fullscreenMode.matches && !document.fullscreenElement;
    fullscreenButton.hidden = installedFullscreen;
    fullscreenButton.disabled = !document.fullscreenEnabled;
    fullscreenButton.textContent = document.fullscreenElement ? 'Выйти из полного экрана' : 'На весь экран';
  }

  function showSettings() {
    matchMenu.hidden = !app.classList.contains('in-match');
    fullscreenStatus.textContent = document.fullscreenEnabled || fullscreenMode.matches
      ? '' : 'Браузер не поддерживает полноэкранный режим. Попробуй установить игру через меню браузера.';
    syncFullscreen();
    settings.showModal();
  }

  fullscreenButton.addEventListener('click', async () => {
    fullscreenStatus.textContent = '';
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        settings.close();
        await document.documentElement.requestFullscreen();
        if (matchMedia('(pointer: coarse)').matches) {
          await window.screen.orientation?.lock?.('landscape').catch(() => {});
        }
      }
    } catch (error) {
      console.warn('Fullscreen request failed', error);
      fullscreenStatus.textContent = 'Не удалось переключить полноэкранный режим.';
      if (!settings.open) settings.showModal();
    }
  });
  document.addEventListener('fullscreenchange', syncFullscreen);
  fullscreenMode.addEventListener('change', syncFullscreen);
  document.querySelector('#start-settings').addEventListener('click', showSettings);

  for (const [id, title, label] of [
    ['new-game', 'Начать новую партию?', 'Новая партия'],
    ['surrender', 'Сдаться?', 'Сдаться'],
  ]) {
    document.getElementById(id).addEventListener('click', () => {
      leaveDialog.querySelector('#leave-title').textContent = title;
      const confirm = leaveDialog.querySelector('#leave-confirm');
      confirm.textContent = label;
      confirm.value = id === 'surrender' ? 'surrender' : 'leave';
      leaveDialog.returnValue = '';
      leaveDialog.showModal();
    });
  }
  leaveDialog.addEventListener('close', () => {
    if (leaveDialog.returnValue === 'leave' || leaveDialog.returnValue === 'surrender') {
      onLeave(leaveDialog.returnValue === 'surrender');
    }
  });

  return {
    showSettings,
    close: () => settings.close(),
    motion: () => motionDuration(speedSetting.value, reducedMotion.matches),
    playSound: sounds.play,
    difficulty: () => difficultySetting.value,
    showBotThoughts: () => thoughts.checked,
  };
}
