export const adjacent = { scope: 'neighbors', type: 'unit' };
export const self = { scope: 'source' };
export const allies = { scope: 'ally', type: 'unit' };
export const enemies = { scope: 'enemy', type: 'unit' };
export const chosen = (ref) => ({ scope: 'ref', ref });
export const action = (action, target, amount) => ({ action, target, amount });
export const ability = (steps, select = []) => ({ steps, select });
export const choice = (ref, targets, prompt, hint) => ({ ref, targets, prompt, ...hint });
export const firestormRow = (amount) => ability([
  { action: 'select-row', ref: 'row', filter: 'any', side: 'enemy', prompt: 'Выбери вражеский ряд для Огненного шторма.' },
  { action: 'row-effect', effect: 'firestorm', side: 'enemy', rowRef: 'row', amount },
]);
export const enemyChoice = (amount) => choice('enemy', enemies,
  'Выбери врага для урона.', { kind: 'damage', amount });
