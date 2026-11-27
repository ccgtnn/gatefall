// The steps use action names registered in effect-operations.js.
// Each shape lists scalar keys and the shapes of its nested values.
// Arrays use the same shape for every element. Map keys marked "*" are data.
function shape(keys, children = {}) {
  return Object.freeze({
    ...Object.fromEntries(keys.trim().split(/\s+/).filter(Boolean).map((key) => [key, null])),
    ...children,
  });
}

const abilityKeys = 'requiresResult sourceRow survivesSource';
const abilityChildren = { select: 'choice', steps: 'step', when: 'abilityCondition' };
const watchedEvents = 'play death first-infection target-marked appearance discard';
const events = (keys, child) => Object.freeze(Object.fromEntries(
  keys.split(' ').map((key) => [key, child]),
));

export const EFFECT_SCHEMA = Object.freeze({
  card: shape(`
    id name type text rarity provision faction power armor shield immune doomed immovable token
    categories keywords shipClass accent art artCrop artFocus artZoom timer startTurnGrowth
    zeal resilience fieldAura sidePowerAura requiredRow preferredRow enemySide stratagem removalReserve
  `, {
    aiHints: 'aiHints', artStates: 'dataMap', growth: 'growth', rowPower: 'rowPower',
    deploy: 'ability', initiative: 'ability', timerPulse: 'ability', timerExpired: 'ability', timerNextTurn: 'ability',
    endTurn: 'ability', deathwish: 'ability', order: 'order', fee: 'fee', counter: 'counter',
    scenario: 'scenario', events: 'events', neighborEvents: 'events',
    fieldEvents: 'fieldEvents', pileEvents: 'pileEvents',
  }),
  leader: shape('id legacyId name text art artFocus artZoom provisionBonus charges keywords', {
    ability: 'ability', order: 'leaderOrder', aiHints: 'aiHints',
  }),
  leaderOrder: shape('cooldown usesCharges quickenedBy'),
  replacementOrder: shape('text cooldown usesCharges quickenedBy', { ability: 'ability' }),
  order: shape(abilityKeys + ' charges cooldown oncePerTurn', { ...abilityChildren, cost: 'ability' }),
  fee: shape(abilityKeys + ' coins needsExhaustedOrder needsSourceSpace', abilityChildren),
  ability: shape(abilityKeys, abilityChildren),
  choice: shape('amount kind mode prompt ref', { targets: 'target' }),
  abilityCondition: shape('atLeast selectable', { targets: 'target' }),
  stepCondition: shape('coinsAtLeast coinsBelow orAlliesCategory', { targets: 'target' }),
  step: shape(`
    action category choose chooseAll effect faction fallbackPosition fullDeck grouped kind measureDamage
    mode multiplier of overflow position preservePower prompt rarity ref requiresResult row rowRef
    save savePosition saveTargets side sourceRow state status type visual
  `, {
    after: 'step', spawn: 'step', slay: 'ability', deathwish: 'ability', when: 'stepCondition',
    target: 'target', receiver: 'target', filter: 'pileFilter',
    amount: 'value', count: 'value', power: 'value',
    card: 'card', replacement: 'card', order: 'replacementOrder', counter: 'counter', tiers: 'dataMap',
  }),
  target: shape(`
    scope of ref row rowRef direction exclude excludeRefs type rarity deathwish unitOrOrder
    cleansable token category anyCategory capture infected marked definitionId armorAtLeast
    powerAtLeast strongest weakest
  `, { powerAtMost: 'value' }),
  pileFilter: shape('anyType rarity category definitionId faction provision maxProvision provisionException maxPower'),
  value: shape(`
    base cap every growth markedThisMatch minimum otherwise playedCategory ref result row scale
    startingCategory stat status then
  `, { count: 'target' }),
  counter: shape('amount', { effect: 'ability' }),
  scenario: shape('category countPlayedEffects finalChapterMinimum trigger', { prologue: 'ability', chapters: 'ability' }),
  events: events(watchedEvents + ' armor armor-break consume damage power-loss spawn status turn-end', 'ability'),
  fieldEvents: events(watchedEvents, 'fieldEvent'),
  pileEvents: events(watchedEvents, 'pileEvent'),
  fieldEvent: shape('category enemy friendly infected shipClasses', { ability: 'ability' }),
  pileEvent: shape('enemy firstLegendary friendly pile', { ability: 'ability' }),
  growth: shape('base label'),
  rowPower: shape('amount key', { requires: 'rowPowerRequirement' }),
  rowPowerRequirement: shape('field values'),
  aiHints: shape(`
    armorBreakCostsPower boardBonus endTurnNeedsMarkedEnemy handPotential leaderChargeValue leaderCoinsAtMost leaderConsume
    leaderOffering leaderZeal leaderShield leaderSpawn placement preferRowWith sacrificeBonus
    spendsRowArmor useOrderWhenReady
  `),
  dataMap: Object.freeze({ '*': null }),
});
