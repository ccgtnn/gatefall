export type Side = 'human' | 'bot';
export type Row = 'orbit' | 'surface';
export type Pile = 'hand' | 'deck' | 'discard' | 'exile';
export type MatchResult = 'win' | 'loss' | 'draw';
export type Counts = Record<string, number>;

export interface Placement {
  row: Row;
  position: number;
}

export interface TargetQuery {
  scope: 'source' | 'ref-set' | 'ref' | 'neighbors' | 'ally' | 'enemy' | 'field';
  ref?: string;
  of?: string;
  row?: Row | 'source';
  rowRef?: string;
  direction?: 'left' | 'right';
  exclude?: string;
  excludeRefs?: readonly string[];
  type?: CardDefinition['type'];
  rarity?: CardDefinition['rarity'];
  definitionId?: string;
  token?: boolean;
  category?: string;
  anyCategory?: readonly string[];
  deathwish?: boolean;
  unitOrOrder?: boolean;
  cleansable?: boolean;
  capture?: boolean;
  infected?: boolean;
  marked?: boolean;
  armorAtLeast?: number;
  powerAtLeast?: number;
  powerAtMost?: EffectValue;
  strongest?: boolean;
  weakest?: boolean;
}

export type EffectValue = number | {
  base?: number;
  scale?: number;
  growth?: boolean;
  result?: string;
  startingCategory?: string;
  every?: number;
  minimum?: number;
  cap?: number;
  playedCategory?: string;
  markedThisMatch?: number;
  count?: TargetQuery;
  status?: string;
  row?: Row;
  then?: number;
  otherwise?: number;
  stat?: string;
  ref?: string;
};

interface PileFilter {
  anyType?: boolean;
  rarity?: CardDefinition['rarity'];
  category?: string;
  definitionId?: string;
  faction?: string;
  provision?: number;
  maxProvision?: number;
  provisionException?: string;
  maxPower?: number;
}

interface EffectChoice {
  ref: string;
  targets: TargetQuery;
  kind?: string;
  mode?: 'random';
  prompt?: string;
  amount?: EffectValue;
}

interface StepCondition {
  targets?: TargetQuery;
  coinsAtLeast?: number;
  coinsBelow?: number;
  orAlliesCategory?: string;
}

export interface EffectStep {
  action: string;
  target?: TargetQuery;
  receiver?: TargetQuery;
  amount?: EffectValue;
  count?: EffectValue;
  power?: EffectValue;
  when?: StepCondition;
  sourceRow?: Row;
  requiresResult?: string;
  mode?: 'random';
  filter?: PileFilter | string;
  card?: CardDefinition;
  replacement?: CardDefinition;
  after?: EffectStep;
  slay?: Ability;
  spawn?: Omit<EffectStep, 'action'>;
  order?: LeaderOrder & { ability: Ability; text?: string };
  counter?: CounterDefinition;
  tiers?: Counts;
  status?: string;
  state?: string;
  effect?: string;
  visual?: string;
  save?: string;
  saveTargets?: string;
  savePosition?: string;
  of?: string;
  ref?: string;
  row?: Row | 'source' | 'all' | 'death' | 'random' | 'strongest';
  rowRef?: string;
  side?: 'ally' | 'enemy';
  position?: 'left' | 'right' | 'death';
  fallbackPosition?: string;
  kind?: string;
  prompt?: string;
  category?: string;
  faction?: string;
  rarity?: CardDefinition['rarity'];
  type?: CardDefinition['type'];
  choose?: number;
  chooseAll?: boolean;
  fullDeck?: boolean;
  overflow?: boolean;
  grouped?: boolean;
  measureDamage?: boolean;
  preservePower?: boolean;
  multiplier?: number;
}

export interface Ability {
  steps: readonly EffectStep[];
  select?: readonly EffectChoice[];
  when?: { targets: TargetQuery; atLeast?: number; selectable?: boolean };
  sourceRow?: Row;
  survivesSource?: boolean;
  requiresResult?: string;
}

interface CardOrder extends Ability {
  charges?: number;
  cooldown?: number;
  oncePerTurn?: boolean;
}

interface Fee extends Ability {
  coins: number;
  needsExhaustedOrder?: boolean;
  needsSourceSpace?: boolean;
}

interface CounterDefinition {
  amount: number;
  effect: Ability;
}

interface FieldEvent {
  ability: Ability;
  friendly?: boolean;
  enemy?: boolean;
  infected?: boolean;
  category?: string;
  shipClasses?: readonly string[];
}

interface PileEvent {
  ability: Ability;
  friendly?: boolean;
  enemy?: boolean;
  firstLegendary?: boolean;
  pile?: 'hand' | 'deck';
}

interface Scenario {
  category: string;
  trigger?: string;
  countPlayedEffects?: string;
  finalChapterMinimum?: number;
  prologue: Ability;
  chapters: readonly Ability[];
}

export interface CardDefinition {
  id: string;
  name: string;
  text?: string;
  type?: 'unit' | 'artifact' | 'effect';
  rarity?: 'bronze' | 'epic' | 'gold';
  faction?: string;
  provision?: number;
  power?: number;
  armor?: number;
  shield?: boolean;
  immune?: boolean;
  doomed?: boolean;
  immovable?: boolean;
  token?: boolean;
  categories?: readonly string[];
  keywords?: readonly string[];
  shipClass?: string;
  accent?: string;
  art?: string;
  artCrop?: string;
  artStates?: Record<string, string>;
  artFocus?: string;
  artZoom?: number;
  requiredRow?: Row;
  preferredRow?: Row;
  row?: Row;
  enemySide?: boolean;
  stratagem?: boolean;
  resilience?: boolean;
  zeal?: boolean;
  timer?: number;
  growth?: { base?: number; label: string };
  fieldAura?: string;
  sidePowerAura?: number;
  sidePower?: { group: string; key: string };
  rowPower?: { key: string; amount: number; requires: { field: string; values: readonly string[] } };
  startTurnGrowth?: number;
  removalReserve?: number;
  aiHints?: Readonly<Record<string, number | boolean | string>>;
  deploy?: Ability;
  initiative?: Ability;
  startTurn?: Ability;
  startTurnPulse?: Ability;
  endTurn?: Ability;
  deathwish?: Ability;
  order?: CardOrder;
  fee?: Fee;
  scenario?: Scenario;
  counter?: CounterDefinition;
  events?: Record<string, Ability>;
  neighborEvents?: Record<string, Ability>;
  fieldEvents?: Record<string, FieldEvent>;
  pileEvents?: Record<string, PileEvent>;
}

export interface CardInstance {
  id: string;
  definition: CardDefinition;
  readyAt: number;
  power?: number;
  basePower?: number;
  armor?: number;
  owner?: Side;
  statuses?: Partial<Record<'lock' | 'shield' | 'doomed' | 'target' | 'infection', number>>;
  infectionSource?: { sourceDefinitionId: string; attacker?: Side };
  orderCharges?: number;
  orderUsedTurn?: number;
  growth?: number;
  timer?: number;
  chapter?: number;
  playedEffects?: number;
  resilient?: boolean;
  counter?: number;
  inheritedDeathwishes?: CardDefinition[];
  artState?: string;
  shipRowBonus?: number;
}

export interface BoardUnit extends Placement {
  side: Side;
  card: CardInstance;
}

interface LeaderOrder {
  cooldown: number;
  usesCharges?: boolean;
  quickenedBy?: string;
  sourceDefinitionId?: string;
}

export interface LeaderDefinition {
  id: string;
  name: string;
  text?: string;
  art?: string;
  artFocus?: string;
  artZoom?: number;
  legacyId?: string;
  provisionBonus?: number;
  charges?: number;
  order?: LeaderOrder;
  ability?: Ability;
  aiHints?: Readonly<Record<string, number | boolean | string>>;
}

interface LeaderState extends LeaderDefinition {
  charges: number;
  lastUsedTurn?: number;
}

interface RowEffect {
  type: string;
  remaining: number;
  sourceDefinitionId?: string;
  attacker?: Side;
}

export interface PlayerState {
  hand: CardInstance[];
  deck: CardInstance[];
  discard: CardInstance[];
  exile: CardInstance[];
  board: Record<Row, CardInstance[]>;
  rowEffects: Partial<Record<Row, RowEffect>>;
  startingCategories: Counts;
  categoryPlays?: Counts;
  effectCategoryPlays?: Counts;
  playedLegendary?: boolean;
  lives: number;
  coins: number;
  marksPlaced: number;
  turns: number;
  usedAbility: boolean;
  roundActed: boolean;
  extraSwaps: number;
  leader: LeaderState | null;
  faction?: string;
  factionId?: string;
  passed: boolean;
}

export interface EffectJob {
  side: Side;
  ability?: Ability;
  discard?: CardInstance;
  rowTick?: boolean;
  scenarioChapter?: boolean;
  startTimer?: boolean;
  cardAbility?: boolean;
  requiredSource?: boolean;
  started?: boolean;
  announced?: boolean;
  sourceId?: string;
  sourceDefinitionId?: string;
  causeDefinitionId?: string;
  sourceGrowth?: number;
  deathwish?: string;
  playedEffects?: number;
  row?: Row;
  position?: number;
  piles?: Pile[];
  pileChoices?: Partial<Record<Pile, CardInstance[]>>;
  priorCategoryPlays?: Counts;
  index?: number;
  refs?: Record<string, string | string[] | Placement>;
  results?: Counts;
  remaining?: string[];
  hits?: number;
  returns?: number;
  created?: CardInstance[];
}

export interface PendingState {
  side: Side;
  kind: string;
  key: string;
  options: string[];
  prompt?: string;
  job: EffectJob;
  selectionSide?: Side;
  amount?: EffectValue;
  amounts?: Counts;
  preferHigherAmount?: boolean;
  cardId?: string;
  pile?: Pile | 'created';
  cards?: CardInstance[];
  fullDeck?: boolean;
  tiers?: Counts;
  armorStrip?: number;
  scatter?: boolean;
}

export interface MatchRules {
  nextStarter: 'winner' | 'alternate';
  leaderCharges: number;
  coinsPersistBetweenRounds: boolean;
}

export interface MatchEvent {
  type: string;
  side?: Side;
  [field: string]: unknown;
}

export interface EmitOptions {
  source?: CardInstance;
  neighbors?: BoardUnit[];
  death?: { row: Row; position: number; refs: { consumer?: string } };
  journal?: boolean;
  side?: Side;
  played?: CardInstance;
  firstLegendary?: boolean;
}

export interface MatchState {
  rules: MatchRules;
  players: Record<Side, PlayerState>;
  phase: 'mulligan' | 'playing' | 'finished';
  mulligan: { used: number; excluded: string[] };
  round: number;
  starter: Side;
  turn: Side | null;
  result: MatchResult | null;
  log: MatchEvent[];
  tokenCount: number;
  effects: EffectJob[];
  pending: PendingState | null;
  playedCard: boolean;
  ending: 'effects' | 'advance' | null;
  startingTurn: boolean;
  surrendered?: boolean;
}

export type Action =
  | ({ type: 'play'; cardId: string } & Partial<Placement>)
  | { type: 'order' | 'fee' | 'target'; cardId: string }
  | ({ type: 'place'; cardId?: never } & Placement)
  | { type: 'leader' | 'pass' | 'end-turn'; cardId?: never };

export interface MatchOptions {
  decks?: Record<Side, readonly CardDefinition[]>;
  humanFaction?: string;
  humanLeader?: string;
  botFaction?: string;
  botLeader?: string;
  random?: () => number;
  rules?: Partial<MatchRules>;
}

export interface ActionOptions {
  random?: () => number;
  copy?: (match: MatchState) => MatchState;
}

export interface Deck {
  id?: string;
  name: string;
  factionId: string;
  leaderId: string;
  cardIds: readonly string[];
}

export interface DeckInspection {
  valid: boolean;
  cards: CardDefinition[];
  counts: Map<string, number>;
  units: number;
  cost: number;
  budget: number;
  overLimit: Set<string>;
  missing: Map<string, number>;
  leader: LeaderDefinition | undefined;
  issues: Record<'cards' | 'units' | 'provisions' | 'copies' | 'ownership' | 'foreign' | 'leader' | 'name', boolean>;
}

export interface Inventory {
  keys: number;
  gold: number;
  essence: number;
  boosters: Counts;
  packCount: number;
  owned: Counts;
  pendingPack: {
    id: number; faction: string; cards: string[]; essenceByCard: Counts; revealed: string[]; prepaid?: boolean;
  } | null;
}

export interface RewardEntry {
  title: string;
  source: string;
  reward: Counts;
}

export interface ProgressOptions {
  random?: () => number;
  now?: () => number;
  enqueueReward?: (entry: RewardEntry) => void;
}

interface TavernQuest { id: string; key: string; progress: number; claimed: boolean }
interface TavernState {
  day: string;
  resetAt: number;
  slots: TavernQuest[];
  pending: TavernQuest[];
  replaced: string | null;
  cursors: Counts;
  finished: string[];
}
interface RankState { period: string; resetAt: number; rounds: number; matches: string[] }
interface LeagueRecord { wins: number; draws: number; losses: number }
interface LeagueSeason {
  tier: number;
  number: number;
  round: number;
  scores: Record<string, LeagueRecord & {
    id: string; points: number; difference: number; roundsWon?: number; roundsLost?: number;
  }>;
  arrivals: Counts;
  previousPlaces?: Counts;
  roundScoring: boolean;
}
interface LeagueState {
  week: string;
  resetAt: number;
  format: number;
  best: { tier: number; place: number | null };
  played: boolean;
  diamond: { wins: number; losses: number; streak: number };
  season: LeagueSeason;
  divisions: Record<number, LeagueSeason>;
  encounters: Record<string, LeagueRecord & { last?: MatchResult }>;
  active: { id: string; stake: number } | null;
  lastReward: ({ tier: number; place: number } & Counts) | null;
}

type Outcome =
  | 'opened' | 'done' | 'unlocked' | 'locked' | 'unaffordable' | 'unavailable'
  | 'unknown' | 'empty' | 'current' | 'stale' | 'claimed' | 'cooldown'
  | 'invalid-deck' | 'invalid-result' | 'max-level' | 'pending' | 'revealed' | 'owned';

export interface Progress {
  get(): { keys: number; unlocked: Set<string> };
  inventory(): Inventory;
  refresh(): void;
  subscribe(listener: () => void): () => boolean;
  unlock(id: string): Promise<Outcome>;
  base(): { materials: Counts; buildings: Record<string, { kind: string; level: number }> };
  production(): Record<string, { outputs: Record<string, { stored: number; capacity: number }>; fill: number; full: boolean }>;
  checkpointProduction(): Promise<Outcome>;
  collect(kind?: string): Promise<Outcome>;
  weeklyOutpost(): { bundle: Counts; remaining: number } | null;
  claimOutpost(): Promise<Outcome>;
  tavern(): TavernState | null;
  checkpointTavern(): Promise<Outcome>;
  changeTavernQuest(key: string): Promise<Outcome>;
  claimTavernQuest(key: string): Promise<Outcome>;
  recordTavernEvents(id: string, offset: number, events: readonly MatchEvent[]): Promise<Outcome>;
  ranks(): RankState;
  rankResetAt(): number;
  checkpointRanks(): Promise<Outcome>;
  league(): LeagueState | null;
  checkpointLeague(): Promise<Outcome>;
  beginLeagueMatch(ticket: string, id: string, deck: Deck): Promise<Outcome>;
  settleLeagueMatch(id: string, result: MatchResult, difference: number, factionId?: string, rounds?: number): Promise<Outcome>;
  rewardMatch(matchId: string, result: MatchResult, factionId?: string, rounds?: number): Promise<Outcome>;
  grantMaterials(reward: Counts, options?: { title?: string; source?: string }): Promise<Outcome>;
  build(slot: string, kind: string): Promise<Outcome>;
  upgrade(kind: string, previousLevel: number): Promise<Outcome>;
  buyPack(id: string): Promise<Outcome>;
  openPack(id: string): Promise<Outcome>;
  revealPack(id: number, cardId: string): Promise<Outcome>;
  finishPack(id: number): Promise<Outcome>;
  craft(id: string): Promise<Outcome>;
  dismantle(id: string): Promise<Outcome>;
}
