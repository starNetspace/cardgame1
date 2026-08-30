import type { BattleMode, BattleState, BattleStore, CardFace, CardMemoryAnswerSource, CardMemoryHistoryEntry, CardMemoryQuality, CardMemoryRecord, CardMemoryStore, CardSource, EnemyDefinition, LearningCardMemory, LearningStore, ReviewRecord, ReviewSession, ReviewStore } from '../types'
import { isEnemyDefinition, isCharacterDefinition } from './data'
import { DEFAULT_CHARACTER } from './rules'

const STORAGE_KEY = 'lexicon-duel-review-v1'
const BATTLE_STORAGE_KEY = 'lexicon-duel-battles-v2'
const LEGACY_BATTLE_STORAGE_KEY = 'lexicon-duel-battle-v1'
const LEARNING_STORAGE_KEY = 'lexicon-duel-learning-v1'
const ACCOUNT_STORAGE_PREFIX = 'lexicon-duel-account-v1:'
export const MISTAKE_CLEAR_STREAK = 3
let activeUsername = 'default'

export function normalizeUsername(value: string): string {
  return value.trim().replace(/\s+/g, ' ').slice(0, 32)
}

export function setActiveUsername(username: string): void {
  activeUsername = normalizeUsername(username) || 'default'
}

export function getActiveUsername(): string {
  return activeUsername
}

function accountStorageKey(kind: 'review' | 'learning' | 'battles' | 'records', username = activeUsername): string {
  return `${ACCOUNT_STORAGE_PREFIX}${encodeURIComponent(normalizeUsername(username) || 'default')}:${kind}`
}

export function loadReviewStore(username = activeUsername): ReviewStore {
  try {
    const stored = localStorage.getItem(accountStorageKey('review', username))
    const legacy = normalizeUsername(username) === 'default' ? localStorage.getItem(STORAGE_KEY) : null
    const parsed = JSON.parse(stored ?? legacy ?? '{}')
    return parsed && typeof parsed === 'object' ? parsed as ReviewStore : {}
  } catch {
    return {}
  }
}

export function saveReviewStore(store: ReviewStore, username = activeUsername): void {
  try { localStorage.setItem(accountStorageKey('review', username), JSON.stringify(store)) } catch { /* local-only storage can be unavailable */ }
}

function emptyLearningStore(): LearningStore {
  return { decks: {}, cards: {} }
}

function isLearningStore(value: unknown): value is LearningStore {
  if (!value || typeof value !== 'object') return false
  const candidate = value as LearningStore
  return Boolean(candidate.decks && typeof candidate.decks === 'object' && candidate.cards && typeof candidate.cards === 'object')
}

export function loadLearningStore(username = activeUsername): LearningStore {
  try {
    const stored = localStorage.getItem(accountStorageKey('learning', username))
    const legacy = normalizeUsername(username) === 'default' ? localStorage.getItem(LEARNING_STORAGE_KEY) : null
    const parsed = JSON.parse(stored ?? legacy ?? 'null')
    return isLearningStore(parsed) ? parsed : emptyLearningStore()
  } catch {
    return emptyLearningStore()
  }
}

export function saveLearningStore(store: LearningStore, username = activeUsername): void {
  try { localStorage.setItem(accountStorageKey('learning', username), JSON.stringify(store)) } catch { /* local-only storage can be unavailable */ }
}

function learningKey(deckId: string, cardId: string): string {
  return `${deckId}|${cardId}`
}

export function updateLearningMemory(store: LearningStore, deckId: string, cardId: string, correct: boolean, now = Date.now(), markMastered = correct): LearningStore {
  const key = learningKey(deckId, cardId)
  const previous = store.cards[key] ?? { deckId, cardId, correctCount: 0, incorrectCount: 0, lastAnsweredAt: 0, lastCorrectAt: 0, lastIncorrectAt: 0, correctStreak: 0 }
  const deck = store.decks[deckId] ?? { deckId, masteredCardIds: [], studySessions: 0, lastStudiedAt: 0, lastCompletedAt: 0 }
  const masteredCardIds = markMastered && !deck.masteredCardIds.includes(cardId) ? [...deck.masteredCardIds, cardId] : deck.masteredCardIds
  const nextCard: LearningCardMemory = {
    ...previous,
    correctCount: previous.correctCount + (correct ? 1 : 0),
    incorrectCount: previous.incorrectCount + (correct ? 0 : 1),
    lastAnsweredAt: now,
    lastCorrectAt: correct ? now : previous.lastCorrectAt,
    lastIncorrectAt: correct ? previous.lastIncorrectAt : now,
    correctStreak: correct ? (previous.correctStreak ?? 0) + 1 : 0,
  }
  return { decks: { ...store.decks, [deckId]: { ...deck, masteredCardIds, lastStudiedAt: now } }, cards: { ...store.cards, [key]: nextCard } }
}

export function startLearningSession(store: LearningStore, deckId: string, now = Date.now()): LearningStore {
  const deck = store.decks[deckId] ?? { deckId, masteredCardIds: [], studySessions: 0, lastStudiedAt: 0, lastCompletedAt: 0 }
  return { ...store, decks: { ...store.decks, [deckId]: { ...deck, studySessions: deck.studySessions + 1, lastStudiedAt: now } } }
}

export function completeLearningDeck(store: LearningStore, deckId: string, now = Date.now()): LearningStore {
  const deck = store.decks[deckId]
  if (!deck) return store
  return { ...store, decks: { ...store.decks, [deckId]: { ...deck, lastCompletedAt: now, lastStudiedAt: now } } }
}

export function resetDeckLearningMemory(store: LearningStore, deckId: string): LearningStore {
  const decks = { ...store.decks }
  delete decks[deckId]
  const cards = Object.fromEntries(Object.entries(store.cards).filter(([, memory]) => memory.deckId !== deckId))
  return { decks, cards }
}

export function getTodayLearnedCount(store: LearningStore, now = Date.now()): number {
  const date = new Date(now)
  const learnedCardIds = new Set(Object.values(store.cards).filter((memory) => {
    if (!memory.lastCorrectAt) return false
    const correctDate = new Date(memory.lastCorrectAt)
    return correctDate.getFullYear() === date.getFullYear() && correctDate.getMonth() === date.getMonth() && correctDate.getDate() === date.getDate()
  }).map((memory) => memory.cardId))
  return learnedCardIds.size
}

export function getLearningMistakes(store: LearningStore, deckId?: string): LearningCardMemory[] {
  return Object.values(store.cards).filter((memory) => memory.incorrectCount > 0 && (memory.correctStreak ?? 0) < MISTAKE_CLEAR_STREAK && (!deckId || memory.deckId === deckId)).sort((a, b) => b.lastIncorrectAt - a.lastIncorrectAt)
}

function isBattleState(value: unknown): value is BattleState {
  if (!value || typeof value !== 'object') return false
  const battle = value as BattleState
  if (battle.status !== 'playing' || battle.player?.hp <= 0 || battle.enemy?.hp <= 0) return false
  if (!battle.player || !battle.enemy || !Array.isArray(battle.hand) || !Array.isArray(battle.drawPile)) return false
  if (![battle.player.hp, battle.player.maxHp, battle.player.shield, battle.player.energy, battle.enemy.hp, battle.enemy.maxHp, battle.enemy.attack, battle.enemy.turns, battle.turn].every(Number.isFinite)) return false
  if (!battle.hand.every((item) => item?.card?.cardId && (item.face === 'meaning' || item.face === 'spelling'))) return false
  if (!battle.drawPile.every((item) => item?.cardId && typeof item.word === 'string')) return false
  if (battle.campaignGoal !== undefined && battle.campaignGoal !== 'defeat-all' && battle.campaignGoal !== 'learn-all') return false
  if (battle.campaignEnemyQueue !== undefined && (!Array.isArray(battle.campaignEnemyQueue) || battle.campaignEnemyQueue.length === 0 || !battle.campaignEnemyQueue.every(isEnemyDefinition))) return false
  if (battle.campaignEnemyIndex !== undefined && (!Number.isInteger(battle.campaignEnemyIndex) || battle.campaignEnemyIndex < 0 || !battle.campaignEnemyQueue || battle.campaignEnemyIndex >= battle.campaignEnemyQueue.length)) return false
  if (battle.campaignEnemyQueue && battle.campaignEnemyIndex === undefined) return false
  if (battle.learningPendingCounts !== undefined && (!battle.learningPendingCounts || typeof battle.learningPendingCounts !== 'object' || Object.values(battle.learningPendingCounts).some((count) => !Number.isInteger(count) || count < 0))) return false
  if (battle.learningLastIncorrectAt !== undefined && (!battle.learningLastIncorrectAt || typeof battle.learningLastIncorrectAt !== 'object' || Object.values(battle.learningLastIncorrectAt).some((time) => !Number.isFinite(time) || time < 0))) return false
  return true
}

function normalizeBattle(battle: BattleState, mode: BattleMode): BattleState {
  const remainingIds = battle.learningRemainingCardIds ?? []
  const normalized = {
    ...battle,
    mode,
    character: battle.character && isCharacterDefinition(battle.character) ? { ...battle.character, cooldowns: battle.character.cooldowns ?? {} } : { ...DEFAULT_CHARACTER, cooldowns: {} },
    enemy: {
      ...battle.enemy,
      id: battle.enemy.id ?? 'default-forgetter',
      name: battle.enemy.name ?? 'THE FORGETTER',
      subtitle: battle.enemy.subtitle ?? '遗忘者',
      alias: battle.enemy.alias,
      icon: battle.enemy.icon ?? 'skull',
      shield: battle.enemy.shield ?? 0,
      abilities: battle.enemy.abilities ?? [{ type: 'attack-scaling', amount: 1, everyTurns: 3, description: '每三回合攻击力增加 1' }],
    },
    learningPendingCounts: battle.learningPendingCounts ?? Object.fromEntries(remainingIds.map((cardId) => [cardId, 1])),
    learningLastIncorrectAt: battle.learningLastIncorrectAt ?? {},
  }
  if (normalized.enemy.hp <= 0) normalized.status = 'victory'
  else if (normalized.player.hp <= 0) normalized.status = 'defeat'
  else normalized.status = 'playing'
  return normalized
}

export function loadBattleStore(username = activeUsername): BattleStore {
  try {
    const stored = localStorage.getItem(accountStorageKey('battles', username))
    const raw = stored ?? (normalizeUsername(username) === 'default' ? localStorage.getItem(BATTLE_STORAGE_KEY) : null)
    const legacyRaw = normalizeUsername(username) === 'default' ? localStorage.getItem(LEGACY_BATTLE_STORAGE_KEY) : null
    const parsed = JSON.parse(raw ?? legacyRaw ?? 'null')
    if (!parsed || typeof parsed !== 'object') return {}
    // Migrate the previous single-slot save into the practice mode.
    if (isBattleState(parsed)) {
      const migrated = { practice: normalizeBattle(parsed, 'practice') }
      if (!raw) localStorage.setItem(BATTLE_STORAGE_KEY, JSON.stringify(migrated))
      return migrated
    }
    const store: BattleStore = {}
    const learning: Record<string, BattleState> = {}
    const savedLearning = (parsed as Record<string, unknown>).learning
    if (savedLearning && typeof savedLearning === 'object') {
      for (const [deckId, candidate] of Object.entries(savedLearning)) if (isBattleState(candidate)) learning[deckId] = normalizeBattle(candidate, 'learning')
    }
    if (Object.keys(learning).length > 0) store.learning = learning
    for (const mode of ['practice', 'online'] as const) {
      const candidate = (parsed as Record<string, unknown>)[mode]
      if (isBattleState(candidate)) {
        if (mode === 'practice') store.practice = normalizeBattle(candidate, mode)
        else store.online = normalizeBattle(candidate, mode)
      }
    }
    if (Object.keys(store).length > 0 && !raw) localStorage.setItem(BATTLE_STORAGE_KEY, JSON.stringify(store))
    return store
  } catch {
    return {}
  }
}

/** Replace one account's complete battle document during import/export recovery. */
export function saveBattleStore(store: BattleStore, username = activeUsername): void {
  try {
    localStorage.setItem(accountStorageKey('battles', username), JSON.stringify(store))
  } catch { /* local-only storage can be unavailable */ }
}

export function saveBattleState(mode: BattleMode, state: BattleState, username = activeUsername): void {
  try {
    if (state.status !== 'playing' || state.player.hp <= 0 || state.enemy.hp <= 0) {
      if (mode === 'learning' && state.learningDeckId) clearLearningBattleState(state.learningDeckId, username)
      else clearBattleState(mode, username)
      return
    }
    const store = loadBattleStore(username)
    if (mode === 'learning') {
      if (!state.learningDeckId) {
        return
      }
      store.learning = { ...(store.learning ?? {}), [state.learningDeckId]: normalizeBattle(state, mode) }
    } else if (mode === 'practice') {
      store.practice = normalizeBattle(state, mode)
    } else {
      store.online = normalizeBattle(state, mode)
    }
    localStorage.setItem(accountStorageKey('battles', username), JSON.stringify(store))
  } catch { /* local-only storage can be unavailable */ }
}

export function clearBattleState(mode?: BattleMode, username = activeUsername): void {
  try {
    if (!mode) {
      localStorage.removeItem(accountStorageKey('battles', username))
      return
    }
    const store = loadBattleStore(username)
    delete store[mode]
    localStorage.setItem(accountStorageKey('battles', username), JSON.stringify(store))
  } catch { /* local-only storage can be unavailable */ }
}

export function saveLearningBattleState(deckId: string, state: BattleState, username = activeUsername): void {
  try {
    if (state.status !== 'playing' || state.player.hp <= 0 || state.enemy.hp <= 0 || !deckId) {
      if (deckId) clearLearningBattleState(deckId)
      return
    }
    const store = loadBattleStore(username)
    store.learning = { ...(store.learning ?? {}), [deckId]: normalizeBattle(state, 'learning') }
    localStorage.setItem(accountStorageKey('battles', username), JSON.stringify(store))
  } catch { /* local-only storage can be unavailable */ }
}

export function clearLearningBattleState(deckId: string, username = activeUsername): void {
  try {
    const store = loadBattleStore(username)
    if (store.learning) {
      delete store.learning[deckId]
      if (Object.keys(store.learning).length === 0) delete store.learning
    }
    localStorage.setItem(accountStorageKey('battles', username), JSON.stringify(store))
  } catch { /* local-only storage can be unavailable */ }
}

export function updateReview(store: ReviewStore, cardId: string, face: CardFace, correct: boolean): ReviewStore {
  const previous: ReviewRecord = store[cardId] ?? {
    cardId, attempts: 0, correct: 0, incorrect: 0, streak: 0, lastSeenAt: 0, lastFace: face, lastCorrect: false, correctStreak: 0,
  }
  return {
    ...store,
    [cardId]: {
      ...previous,
      attempts: previous.attempts + 1,
      correct: previous.correct + (correct ? 1 : 0),
      incorrect: previous.incorrect + (correct ? 0 : 1),
      streak: correct ? previous.streak + 1 : 0,
      lastSeenAt: Date.now(),
      lastFace: face,
      lastCorrect: correct,
      correctStreak: correct ? (previous.correctStreak ?? 0) + 1 : 0,
    },
  }
}

export function getReviewMistakes(store: ReviewStore): ReviewRecord[] {
  return Object.values(store)
    .filter((record) => record.incorrect > 0 && (record.correctStreak ?? 0) < MISTAKE_CLEAR_STREAK)
    .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
}

export function limitMistakeIds(ids: string[], maxCount?: number): string[] {
  return Number.isInteger(maxCount) && (maxCount as number) > 0 ? ids.slice(0, maxCount) : ids
}

export function isValidMistakePracticeCount(availableCount: number, requestedCount?: number): boolean {
  if (availableCount < 10) return false
  const count = requestedCount === undefined ? availableCount : requestedCount
  return Number.isInteger(count) && count >= 10
}

export function allReviewStats(store: ReviewStore) {
  const records = Object.values(store)
  return {
    studied: records.length,
    attempts: records.reduce((sum, item) => sum + item.attempts, 0),
    correct: records.reduce((sum, item) => sum + item.correct, 0),
    incorrect: records.reduce((sum, item) => sum + item.incorrect, 0),
  }
}

const CARD_MEMORY_STORAGE_KEY = 'records'
export const MAX_CARD_MEMORY_HISTORY = 100
const CARD_MEMORY_QUALITIES: CardMemoryQuality[] = ['bronze', 'silver', 'gold', 'mastered']

export const DAY_MS = 24 * 60 * 60 * 1000
export const HOUR_MS = 60 * 60 * 1000
export const MINUTE_MS = 60 * 1000
export const MIN_DUE_LEAD_MS = 30 * MINUTE_MS

// 0-based interval table. The 0 entry for bronze means "当日稍后" (same day).
// Upgrade happens as soon as streak reaches the level's table length.
const CARD_MEMORY_INTERVALS: Record<CardMemoryQuality, number[]> = {
  bronze: [0, 1, 2, 4],
  silver: [7, 10, 14, 21],
  gold: [21, 30, 45],
  mastered: [60, 90],
}

function startOfDayMs(now: number): number {
  const date = new Date(now)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

function endOfDayMs(now: number): number {
  const date = new Date(now)
  date.setHours(23, 59, 59, 999)
  return date.getTime()
}

function sameDayDueAt(now: number, rng: () => number): number {
  // 当日稍后：当天 23:59 减去随机 0~2 小时。
  const due = endOfDayMs(now) - Math.floor(rng() * 2 * HOUR_MS)
  const minimum = now + MIN_DUE_LEAD_MS
  if (due >= minimum) return due
  // 临近深夜无法满足下限时，顺延至次日 06:00~09:00。
  return startOfDayMs(now) + DAY_MS + (6 + Math.floor(rng() * 3)) * HOUR_MS
}

function crossDayDueAt(now: number, days: number, rng: () => number): number {
  // 跨天间隔：±10% 抖动作用于天级间隔，落在目标日 00:00 + 随机 6~18 小时。
  const jitteredDays = days * (0.9 + 0.2 * rng())
  const targetStart = startOfDayMs(now) + Math.round(jitteredDays) * DAY_MS
  const due = targetStart + (6 + Math.floor(rng() * 12)) * HOUR_MS
  return Math.max(due, now + MIN_DUE_LEAD_MS)
}

function intervalDays(quality: CardMemoryQuality, streak: number): number {
  const intervals = CARD_MEMORY_INTERVALS[quality]
  return intervals[Math.min(Math.max(streak, 0), intervals.length - 1)]
}

function computeDueAt(quality: CardMemoryQuality, streak: number, now: number, rng: () => number): number {
  const days = intervalDays(quality, streak)
  if (days === 0) return sameDayDueAt(now, rng)
  return crossDayDueAt(now, days, rng)
}

function nextQuality(quality: CardMemoryQuality): CardMemoryQuality {
  const index = CARD_MEMORY_QUALITIES.indexOf(quality)
  return CARD_MEMORY_QUALITIES[Math.min(index + 1, CARD_MEMORY_QUALITIES.length - 1)]
}

function prevQuality(quality: CardMemoryQuality): CardMemoryQuality {
  const index = CARD_MEMORY_QUALITIES.indexOf(quality)
  return CARD_MEMORY_QUALITIES[Math.max(index - 1, 0)]
}

function isCardMemoryQuality(value: unknown): value is CardMemoryQuality {
  return typeof value === 'string' && CARD_MEMORY_QUALITIES.includes(value as CardMemoryQuality)
}

function normalizeCardMemoryHistory(value: unknown): CardMemoryHistoryEntry[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is CardMemoryHistoryEntry => {
    if (!item || typeof item !== 'object') return false
    const entry = item as CardMemoryHistoryEntry
    return Number.isFinite(entry.at) && typeof entry.correct === 'boolean' && (entry.face === 'meaning' || entry.face === 'spelling') && isCardMemoryQuality(entry.quality) && Number.isInteger(entry.streak) && entry.streak >= 0 && Number.isFinite(entry.dueAt) && (entry.abandoned === undefined || typeof entry.abandoned === 'boolean')
  }).slice(-MAX_CARD_MEMORY_HISTORY)
}

function normalizeCardMemoryRecord(value: unknown, cardId: string): CardMemoryRecord | null {
  if (!value || typeof value !== 'object') return null
  const record = value as CardMemoryRecord
  if (record.cardId !== cardId || !isCardMemoryQuality(record.quality) || !Number.isInteger(record.streak) || record.streak < 0 || !Number.isFinite(record.dueAt) || !Number.isInteger(record.lapses) || record.lapses < 0) return null
  // 老数据迁移：streak 若超出新表长度则截断；不触发补升级或回退。
  const streak = Math.min(record.streak, CARD_MEMORY_INTERVALS[record.quality].length - 1)
  return { cardId, quality: record.quality, streak, dueAt: record.dueAt, history: normalizeCardMemoryHistory(record.history), lapses: record.lapses }
}

export function normalizeCardMemoryStore(value: unknown): CardMemoryStore {
  if (!value || typeof value !== 'object') return {}
  const output: CardMemoryStore = {}
  for (const [cardId, candidate] of Object.entries(value)) {
    const record = normalizeCardMemoryRecord(candidate, cardId)
    if (record) output[cardId] = record
  }
  return output
}

export function loadCardMemoryStore(username = activeUsername): CardMemoryStore {
  try {
    const raw = localStorage.getItem(accountStorageKey(CARD_MEMORY_STORAGE_KEY, username))
    return normalizeCardMemoryStore(JSON.parse(raw ?? '{}'))
  } catch {
    return {}
  }
}

export function saveCardMemoryStore(store: CardMemoryStore, username = activeUsername): void {
  try { localStorage.setItem(accountStorageKey(CARD_MEMORY_STORAGE_KEY, username), JSON.stringify(store)) } catch { /* local-only storage can be unavailable */ }
}

export interface CardMemoryAnswerOptions {
  abandoned?: boolean
  source?: CardMemoryAnswerSource
  rng?: () => number
}

export function updateCardMemory(store: CardMemoryStore, cardId: string, face: CardFace, correct: boolean, now = Date.now(), options: CardMemoryAnswerOptions = {}): CardMemoryStore {
  const rng = options.rng ?? Math.random
  const source = options.source ?? 'due'
  const abandoned = options.abandoned ?? false
  const previous = store[cardId]

  // 局内重现走轻记账：仅追加 history，不动 quality/streak/dueAt/lapses。
  if (source === 'requeue') {
    if (!previous) return store
    const history = [...previous.history, { at: now, correct, face, abandoned: abandoned || undefined, quality: previous.quality, streak: previous.streak, dueAt: previous.dueAt }].slice(-MAX_CARD_MEMORY_HISTORY)
    return { ...store, [cardId]: { ...previous, history } }
  }

  // 普通新题沿用一期规则：答对但无档不建档。
  if (!previous && correct) return store
  const base: CardMemoryRecord = previous ?? { cardId, quality: 'bronze', streak: 0, dueAt: now, history: [], lapses: 0 }
  let quality: CardMemoryQuality
  let streak: number
  if (correct) {
    streak = base.streak + 1
    if (streak >= CARD_MEMORY_INTERVALS[base.quality].length && base.quality !== 'mastered') {
      quality = nextQuality(base.quality)
      streak = 0
    } else {
      quality = base.quality
    }
  } else {
    quality = prevQuality(base.quality)
    streak = 0
  }
  const dueAt = computeDueAt(quality, streak, now, rng)
  const history = [...base.history, { at: now, correct, face, abandoned: abandoned || undefined, quality, streak, dueAt }].slice(-MAX_CARD_MEMORY_HISTORY)
  return { ...store, [cardId]: { cardId, quality, streak, dueAt, history, lapses: base.lapses + (correct ? 0 : 1) } }
}

export function cardMemoryQualityLabel(quality: CardMemoryQuality): string {
  return ({ bronze: '青铜', silver: '白银', gold: '黄金', mastered: '已掌握' })[quality]
}

export type CardMemorySort = 'due' | 'recent' | 'lapses' | 'word'

export function sortCardMemoryRecords(records: CardMemoryRecord[], sort: CardMemorySort = 'due', now = Date.now()): CardMemoryRecord[] {
  return [...records].sort((a, b) => {
    if (sort === 'recent') return (b.history[b.history.length - 1]?.at ?? 0) - (a.history[a.history.length - 1]?.at ?? 0) || a.cardId.localeCompare(b.cardId)
    if (sort === 'lapses') return b.lapses - a.lapses || a.dueAt - b.dueAt || a.cardId.localeCompare(b.cardId)
    if (sort === 'word') return a.cardId.localeCompare(b.cardId)
    return Number(a.dueAt > now) - Number(b.dueAt > now) || a.dueAt - b.dueAt || a.cardId.localeCompare(b.cardId)
  })
}

export function getCardMemorySummary(store: CardMemoryStore, now = Date.now()) {
  const records = Object.values(store)
  const byQuality = Object.fromEntries(CARD_MEMORY_QUALITIES.map((quality) => [quality, records.filter((record) => record.quality === quality).length])) as Record<CardMemoryQuality, number>
  return { total: records.length, due: records.filter((record) => record.dueAt <= now).length, lapses: records.reduce((sum, record) => sum + record.lapses, 0), byQuality }
}

/** Sorted due card ids (earliest dueAt first), excluding nothing. Callers filter by known card ids. */
export function getDueCardIds(store: CardMemoryStore, now = Date.now()): string[] {
  return Object.values(store)
    .filter((record) => record.dueAt <= now)
    .sort((a, b) => a.dueAt - b.dueAt || a.cardId.localeCompare(b.cardId))
    .map((record) => record.cardId)
}

export function getDueCards(store: CardMemoryStore, now = Date.now(), limit?: number): string[] {
  const ids = getDueCardIds(store, now)
  return Number.isInteger(limit) && (limit as number) > 0 ? ids.slice(0, limit) : ids
}

export function getNextDueAt(store: CardMemoryStore, now = Date.now()): number | null {
  const future = Object.values(store).map((record) => record.dueAt).filter((dueAt) => dueAt > now)
  if (future.length === 0) return null
  return Math.min(...future)
}

export function dueCardCount(store: CardMemoryStore, now = Date.now()): number {
  return Object.values(store).filter((record) => record.dueAt <= now).length
}

export const MAX_REQUEUE_PER_CARD = 2
const REQUEUE_MIN_DELAY = 5
const REQUEUE_MAX_DELAY = 8

export function createReviewSession(): ReviewSession {
  return { newSinceReview: 0, requeueReady: [], requeueScheduled: [], requeueShown: {}, answeredCount: 0, dueUsed: [] }
}

/** Record an in-session answer; schedule a requeue (5~8 questions later) for wrong answers, capped at 2 per card. */
export function recordAnswer(session: ReviewSession, cardId: string, correct: boolean, rng: () => number = Math.random): ReviewSession {
  const next: ReviewSession = {
    ...session,
    requeueReady: [...session.requeueReady],
    requeueScheduled: session.requeueScheduled.map((item) => ({ ...item })),
    requeueShown: { ...session.requeueShown },
    dueUsed: [...session.dueUsed],
    answeredCount: session.answeredCount + 1,
  }
  if (!correct && (next.requeueShown[cardId] ?? 0) < MAX_REQUEUE_PER_CARD) {
    const delay = REQUEUE_MIN_DELAY + Math.floor(rng() * (REQUEUE_MAX_DELAY - REQUEUE_MIN_DELAY + 1))
    next.requeueScheduled.push({ cardId, showAtAnswer: next.answeredCount + delay })
  }
  return next
}

export interface DealtCard {
  cardId: string
  source: CardSource
}

export interface PlanDealOptions {
  fourNewOneOld?: boolean
}

/** Decide which cards to deal next: requeue first, then due injection per four-new-one-old, then new cards. */
export function planDeal(session: ReviewSession, newCardIds: string[], dueCardIds: string[], desired: number, options: PlanDealOptions = {}): { dealt: DealtCard[]; nextSession: ReviewSession } {
  const fourNewOneOld = options.fourNewOneOld ?? true
  const next: ReviewSession = {
    ...session,
    requeueReady: [...session.requeueReady],
    requeueScheduled: session.requeueScheduled.map((item) => ({ ...item })),
    requeueShown: { ...session.requeueShown },
    dueUsed: [...session.dueUsed],
  }
  const promotedIds = next.requeueScheduled.filter((item) => item.showAtAnswer <= next.answeredCount).map((item) => item.cardId)
  next.requeueScheduled = next.requeueScheduled.filter((item) => item.showAtAnswer > next.answeredCount)
  const ready = [...next.requeueReady, ...promotedIds]
  next.requeueReady = []

  const requeueIds = new Set([...next.requeueScheduled.map((item) => item.cardId), ...ready])
  const dueQueue = dueCardIds.filter((id) => !next.dueUsed.includes(id) && !requeueIds.has(id))
  const newQueue = [...newCardIds]
  const dealt: DealtCard[] = []

  for (let index = 0; index < desired; index += 1) {
    if (ready.length > 0) {
      const cardId = ready.shift() as string
      if ((next.requeueShown[cardId] ?? 0) < MAX_REQUEUE_PER_CARD) {
        next.requeueShown[cardId] = (next.requeueShown[cardId] ?? 0) + 1
        dealt.push({ cardId, source: 'requeue' })
        continue
      }
    }
    const dueEligible = fourNewOneOld ? next.newSinceReview >= 4 : true
    if (dueEligible && dueQueue.length > 0) {
      const cardId = dueQueue.shift() as string
      next.dueUsed.push(cardId)
      next.newSinceReview = 0
      dealt.push({ cardId, source: 'due' })
      continue
    }
    if (newQueue.length > 0) {
      const cardId = newQueue.shift() as string
      next.newSinceReview += 1
      dealt.push({ cardId, source: 'new' })
      continue
    }
    if (dueQueue.length > 0) {
      const cardId = dueQueue.shift() as string
      next.dueUsed.push(cardId)
      dealt.push({ cardId, source: 'due' })
      continue
    }
    break
  }
  next.requeueReady = ready
  return { dealt, nextSession: next }
}

/** At session end, requeue cards that were never re-shown become due "当日稍后". */
export function settleUnshownRequeue(store: CardMemoryStore, session: ReviewSession, now: number, rng: () => number = Math.random): CardMemoryStore {
  const unshown = new Set<string>()
  for (const item of session.requeueScheduled) unshown.add(item.cardId)
  for (const cardId of session.requeueReady) unshown.add(cardId)
  let next = store
  for (const cardId of unshown) {
    const record = next[cardId]
    if (!record) continue
    const dueAt = sameDayDueAt(now, rng)
    next = { ...next, [cardId]: { ...record, dueAt } }
  }
  return next
}
