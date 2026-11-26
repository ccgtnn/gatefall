export function spawnRowLabel({ key, job }, row) {
  const spawn = job?.ability?.steps.find((step) => step.action === 'spawn' && step.rowRef === key);
  return spawn?.card?.name ? `Породить «${spawn.card.name}» ×${spawn.amount} в ряду «${row}»`
    : `Выбрать ряд «${row}» для порождения`;
}

export function tributeLabel({ job, tiers }, cost) {
  if (cost === '0') return 'Без взноса';
  const tribute = job?.ability?.steps.find(({ action }) => action === 'choose-tribute');
  const name = tribute?.spawn?.card?.name;
  return name ? `◉ ${cost} · ${name} ×${tiers[cost]}` : `◉ ${cost}`;
}
