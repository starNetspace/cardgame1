export type FrequencyLevel = 1 | 2 | 3 | 4 | 5
export type CardFace = 'meaning' | 'spelling'
export type EffectType = 'attack' | 'shield' | 'boost' | 'draw' | 'heal'
export type BattleMode = 'learning' | 'practice' | 'online'
export type StudyDeckCategory = 'standard' | 'low-frequency' | 'topic'
export type EnemyIcon = 'skull' | 'flame' | 'eye' | 'crown' | 'zap' | 'shield'
export type EnemyAbilityType = 'fixed-shield-per-turn' | 'attack-scaling' | 'start-shield' | 'heal-per-turn' | 'enrage' | 'direct-damage-per-turn' | 'shield-breaker' | 'shield-ignore' | 'revive-once' | 'instant-kill-at-turn'
export type CharacterAbilityKind = 'passive' | 'active'
export type CharacterAbilityType = 'passive-start-shield' | 'passive-max-hp' | 'passive-heal-per-turn' | 'passive-shield-per-turn' | 'passive-card-bonus' | 'passive-wrong-penalty' | 'active-heal' | 'active-shield' | 'active-damage' | 'active-clear-shield-convert' | 'active-immunity-reflect' | 'active-heal-current-hp-damage' | 'active-repeat-last-turn-damage' | 'active-double-next-card' | 'active-swap-health-shield' | 'active-turn-card-bonus' | 'active-gain-energy'
export type CampaignRoute = 'set' | 'all'

export interface EnemyAbility {
  type: EnemyAbilityType
  amount: number
  everyTurns?: number
  threshold?: number
  cooldown?: number
  turnLimit?: number
  description: string
}

export interface EnemyDefinition {
  id: string
  name: string
  subtitle: string
  alias?: string
  icon?: EnemyIcon
  avatar?: string
  maxHp: number
  attack: number
  shield?: number
  abilities: EnemyAbility[]
  isFinal?: boolean
}

export interface CharacterAbility {
  id: string
  kind: CharacterAbilityKind
  type: CharacterAbilityType
  amount: number
  cooldown?: number
  description: string
}

export interface CharacterDefinition {
  id: string
  name: string
  subtitle: string
  alias?: string
  icon?: EnemyIcon
  avatar?: string
  maxHp: number
  shield?: number
  abilities: CharacterAbility[]
}

export interface CharacterConfig {
  version: number
  selectedCharacterId?: string
  characters: CharacterDefinition[]
}

export interface CampaignSet {
  id: string
  title: string
  description: string
  enemies: EnemyDefinition[]
}

export interface CampaignModeConfig {
  sets: CampaignSet[]
}

export interface CampaignConfig {
  version: number
  practice: CampaignModeConfig
  learning: CampaignModeConfig
}

export interface CardRecord {
  cardId: string
  face: CardFace
  word: string
  phonetic: string
  pos: string
  meaning: string
  frequencyLevel: FrequencyLevel
  frequencyLabel: string
  effectType: EffectType
}

export interface RuntimeCard {
  instanceId: string
  card: CardRecord
  face: CardFace
}

export interface MeaningOption {
  cardId: string
  word: string
  pos: string
  meaning: string
}

export type QuestionState =
  | { type: 'meaning'; card: RuntimeCard; options: MeaningOption[] }
  | { type: 'spelling'; card: RuntimeCard }

export interface ReviewRecord {
  cardId: string
  attempts: number
  correct: number
  incorrect: number
  streak: number
  lastSeenAt: number
  lastFace: CardFace
  lastCorrect: boolean
  correctStreak?: number
}

export type ReviewStore = Record<string, ReviewRecord>
export type CardMemoryQuality = 'bronze' | 'silver' | 'gold' | 'mastered'

export interface CardMemoryHistoryEntry {
  at: number
  correct: boolean
  face: CardFace
  abandoned?: boolean
  quality: CardMemoryQuality
  streak: number
  dueAt: number
}

export interface CardMemoryRecord {
  cardId: string
  quality: CardMemoryQuality
  streak: number
  dueAt: number
  history: CardMemoryHistoryEntry[]
  lapses: number
}

export type CardMemoryStore = Record<string, CardMemoryRecord>

export type CardMemoryAnswerSource = 'due' | 'requeue'
export type CardSource = 'new' | 'due' | 'requeue'

export interface RequeueScheduled {
  cardId: string
  showAtAnswer: number
}

/** In-memory (never persisted) scheduling state for the four-new-one-old rhythm and in-session requeue. */
export interface ReviewSession {
  newSinceReview: number
  requeueReady: string[]
  requeueScheduled: RequeueScheduled[]
  requeueShown: Record<string, number>
  answeredCount: number
  dueUsed: string[]
}




export interface StudySubgroup {
  subgroupId: string
  title: string
  cardIds: string[]
}

export interface StudyDeck {
  deckId: string
  title: string
  category: StudyDeckCategory
  description: string
  cardIds: string[]
  subgroups: StudySubgroup[]
  totalCards: number
}

export interface LearningDeckProgress {
  deckId: string
  masteredCardIds: string[]
  studySessions: number
  lastStudiedAt: number
  lastCompletedAt: number
}

export interface LearningCardMemory {
  deckId: string
  cardId: string
  correctCount: number
  incorrectCount: number
  lastAnsweredAt: number
  lastCorrectAt: number
  lastIncorrectAt: number
  correctStreak?: number
}

export interface LearningStore {
  decks: Record<string, LearningDeckProgress>
  cards: Record<string, LearningCardMemory>
}

export type LearningBattleStore = Record<string, BattleState>

export interface EnemyState {
  id: string
  name: string
  subtitle: string
  alias?: string
  icon?: EnemyIcon
  avatar?: string
  maxHp: number
  hp: number
  shield: number
  attack: number
  turns: number
  abilities: EnemyAbility[]
  abilityCooldowns?: Record<string, number>
  reviveUsed?: boolean
}

export interface PlayerState {
  maxHp: number
  hp: number
  shield: number
  energy: number
  immuneThisTurn?: boolean
  reflectThisTurn?: boolean
  nextCardDoubled?: boolean
  turnCardBonus?: number
  cardsAsAttackUntilEndTurn?: boolean
}

export interface CharacterState extends CharacterDefinition {
  cooldowns: Record<string, number>
}

export interface BattleState {
  mode: BattleMode
  character: CharacterState
  player: PlayerState
  enemy: EnemyState
  hand: RuntimeCard[]
  drawPile: CardRecord[]
  discardCount: number
  turn: number
  boost: number
  status: 'playing' | 'victory' | 'defeat'
  usedCards: number
  correctAnswers: number
  totalAnswers: number
  faceStats: { meaning: { correct: number; total: number }; spelling: { correct: number; total: number } }
  errorCardIds: string[]
  log: string[]
  turnDamageDealt?: number
  lastTurnDamageDealt?: number
  turnCorrectEffectiveCards?: number
  lastTurnCorrectEffectiveCards?: number
  learningDeckId?: string
  learningCardIds?: string[]
  learningRemainingCardIds?: string[]
  learningPendingCounts?: Record<string, number>
  learningLastIncorrectAt?: Record<string, number>
  mistakeSource?: 'practice' | 'learning' | 'all'
  mistakePracticeCardIds?: string[]
  mistakeLearningCardIds?: string[]
  reviewRun?: boolean
  campaignGoal?: 'defeat-all' | 'learn-all'
  campaignSetId?: string
  campaignEnemyQueue?: EnemyDefinition[]
  campaignEnemyIndex?: number
}

export interface BattleStore {
  learning?: LearningBattleStore
  practice?: BattleState
  online?: BattleState
}

export interface AccountInfo {
  username: string
  createdAt: number
  lastUsedAt: number
  selectedCharacterId?: string
}

export interface AccountRegistry {
  version: number
  activeUsername: string
  accounts: Record<string, AccountInfo>
}

export interface AccountExport {
  format: 'lexicon-duel-account'
  version: 1
  username: string
  exportedAt: number
  selectedCharacterId?: string
  review: ReviewStore
  learning: LearningStore
  battles: BattleStore
  records?: CardMemoryStore
}
