import type { CardRecord, LearningStore, StudyDeck, StudyDeckCategory, StudySubgroup } from '../shared/domain-types'

// Decks are built from "word units". Each unit is one word + part of speech
// (identified by its base card id) and expands into a meaning card and a
// spelling card, so a 30-unit deck holds 60 cards.
const WORDS_PER_DECK = 30
const SUBGROUP_COUNT = 5
const WORDS_PER_SUBGROUP = 6
const HIGH_LEVELS = new Set([1, 2])

const MONTHS = new Set([
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
])

const COUNTRY_WORDS = new Set([
  'america', 'american', 'argentina', 'australia', 'australian', 'austria', 'austrian',
  'belgium', 'belgian', 'brazil', 'brazilian', 'britain', 'british', 'canada', 'canadian',
  'china', 'chinese', 'denmark', 'danish', 'egypt', 'egyptian', 'europe', 'european',
  'finland', 'finnish', 'france', 'french', 'germany', 'german', 'greece', 'greek',
  'india', 'indian', 'indonesia', 'indonesian', 'ireland', 'irish', 'italy', 'italian',
  'japan', 'japanese', 'korea', 'korean', 'mexico', 'mexican', 'norway', 'norwegian',
  'poland', 'polish', 'portugal', 'portuguese', 'russia', 'russian', 'scotland', 'scottish',
  'spain', 'spanish', 'sweden', 'swedish', 'switzerland', 'swiss', 'turkey', 'turkish',
  'america', 'africa', 'african', 'asia', 'asian', 'canadian',
])

const WEATHER_WORDS = new Set([
  'weather', 'climate', 'rain', 'rainy', 'snow', 'snowy', 'wind', 'windy', 'storm',
  'thunder', 'lightning', 'fog', 'foggy', 'mist', 'cloud', 'cloudy', 'sunny', 'sunshine',
  'hurricane', 'frost', 'frosty', 'breeze', 'temperature', 'humid', 'humidity', 'drought',
  'flood', 'flooding', 'ice', 'icy', 'blizzard', 'typhoon', 'tornado', 'heat', 'cold',
])

const TOPIC_LABELS: Record<string, { title: string; description: string; words: Set<string>; meaning: RegExp }> = {
  months: { title: '月份', description: 'January 至 December', words: MONTHS, meaning: /一月|二月|三月|四月|五月|六月|七月|八月|九月|十月|十一月|十二月/ },
  countries: { title: '国家与国籍', description: '国家、地区及其国籍表达', words: COUNTRY_WORDS, meaning: /国家|国籍|美国|英国|法国|德国|中国|日本|加拿大|印度|意大利|西班牙|俄罗斯|欧洲|亚洲|非洲/ },
  weather: { title: '天气与自然现象', description: '天气、气候和自然现象', words: WEATHER_WORDS, meaning: /天气|气候|下雨|雨|雪|风|暴风|雷|闪电|雾|云|晴|阴|飓风|霜|洪水|温度|潮湿|干旱|冰雹/ },
}

interface WordUnit {
  baseId: string
  meaning?: CardRecord
  spelling?: CardRecord
}

function baseCardIdOf(card: CardRecord): string {
  if (card.face === 'spelling' && card.cardId.endsWith('-spelling')) {
    return card.cardId.slice(0, -'-spelling'.length)
  }
  return card.cardId
}

function groupIntoUnits(cards: CardRecord[]): WordUnit[] {
  const byId = new Map<string, WordUnit>()
  for (const card of cards) {
    const baseId = baseCardIdOf(card)
    let unit = byId.get(baseId)
    if (!unit) {
      unit = { baseId }
      byId.set(baseId, unit)
    }
    if (card.face === 'meaning') unit.meaning = card
    else unit.spelling = card
  }
  return [...byId.values()]
}

function unitCards(unit: WordUnit): CardRecord[] {
  return [unit.meaning, unit.spelling].filter((card): card is CardRecord => card !== undefined)
}

function unitRepresentative(unit: WordUnit): CardRecord {
  return unit.meaning ?? unit.spelling!
}

function unitWord(unit: WordUnit): string {
  return unitRepresentative(unit).word.trim().toLowerCase()
}

function unitFrequencyLevel(unit: WordUnit): number {
  return unitRepresentative(unit).frequencyLevel
}

function unitOrder(a: WordUnit, b: WordUnit): number {
  return unitWord(a).localeCompare(unitWord(b)) || a.baseId.localeCompare(b.baseId)
}

function unitFirstLetter(unit: WordUnit): string {
  return unitWord(unit).match(/[a-z]/)?.[0] ?? 'z'
}

function rotatePick(pool: WordUnit[], cursor: string): { unit: WordUnit; nextCursor: string } | null {
  if (pool.length === 0) return null
  const sorted = [...pool].sort(unitOrder)
  const start = sorted.findIndex((unit) => unitFirstLetter(unit) >= cursor)
  const index = start < 0 ? 0 : start
  const unit = sorted[index]
  const letter = unitFirstLetter(unit)
  const nextCursor = String.fromCharCode(letter.charCodeAt(0) + 1)
  return { unit, nextCursor: nextCursor > 'z' ? 'a' : nextCursor }
}

function takeRotating(pool: WordUnit[], cursor: string): { unit: WordUnit; nextCursor: string } | null {
  const picked = rotatePick(pool, cursor)
  if (!picked) return null
  const index = pool.findIndex((unit) => unit.baseId === picked.unit.baseId)
  pool.splice(index, 1)
  return picked
}

function seededShuffle<T>(items: T[], seed: number): T[] {
  const result = [...items]
  let value = (seed + 1) * 2654435761
  for (let index = result.length - 1; index > 0; index -= 1) {
    value = (value * 1664525 + 1013904223) >>> 0
    const target = value % (index + 1)
    ;[result[index], result[target]] = [result[target], result[index]]
  }
  return result
}

function makeSubgroups(units: WordUnit[], deckIndex: number): StudySubgroup[] {
  return Array.from({ length: SUBGROUP_COUNT }, (_, index) => {
    const start = index * WORDS_PER_SUBGROUP
    const subgroupUnits = seededShuffle(units.slice(start, start + WORDS_PER_SUBGROUP), deckIndex * 17 + index)
    return {
      subgroupId: `part-${index + 1}`,
      title: `小组 ${String(index + 1).padStart(2, '0')}`,
      cardIds: subgroupUnits.flatMap((unit) => unitCards(unit).map((card) => card.cardId)),
    }
  })
}

function makeDeck(deckId: string, title: string, category: StudyDeckCategory, description: string, units: WordUnit[], deckIndex: number): StudyDeck {
  const shuffledUnits = seededShuffle(units, deckIndex + 101)
  const cardIds = shuffledUnits.flatMap((unit) => unitCards(unit).map((card) => card.cardId))
  return { deckId, title, category, description, cardIds, subgroups: makeSubgroups(units, deckIndex), totalCards: cardIds.length }
}

function chunkUnits(units: WordUnit[], size: number): WordUnit[][] {
  if (size <= 0) return []
  const result: WordUnit[][] = []
  for (let index = 0; index < units.length; index += size) result.push(units.slice(index, index + size))
  return result
}

export function buildStandardDecks(cards: CardRecord[]): StudyDeck[] {
  const units = groupIntoUnits(cards)
  const highPool = units.filter((unit) => HIGH_LEVELS.has(unitFrequencyLevel(unit)))
  const middlePool = units.filter((unit) => unitFrequencyLevel(unit) === 3)
  const lowPool = units.filter((unit) => unitFrequencyLevel(unit) >= 4)
  const decks: StudyDeck[] = []
  let deckIndex = 0
  let cursor = 'a'

  // A standard deck is created only when all mandatory quotas can be met.
  while (highPool.length >= SUBGROUP_COUNT * 3 && middlePool.length >= SUBGROUP_COUNT && highPool.length + middlePool.length + lowPool.length >= WORDS_PER_DECK) {
    const subgroups: WordUnit[][] = []
    let complete = true

    for (let subgroup = 0; subgroup < SUBGROUP_COUNT; subgroup += 1) {
      const subgroupUnits: WordUnit[] = []
      for (let count = 0; count < 3; count += 1) {
        const picked = takeRotating(highPool, cursor)
        if (!picked) {
          complete = false
          break
        }
        subgroupUnits.push(picked.unit)
        cursor = picked.nextCursor
      }
      if (!complete) break

      const middle = takeRotating(middlePool, cursor)
      if (!middle) {
        complete = false
        break
      }
      subgroupUnits.push(middle.unit)
      cursor = middle.nextCursor

      // Fill each six-word subgroup from the high-frequency side first,
      // then L3, and only use L4/L5 when both pools are exhausted.
      while (subgroupUnits.length < WORDS_PER_SUBGROUP) {
        const filler = takeRotating(highPool, cursor) ?? takeRotating(middlePool, cursor) ?? takeRotating(lowPool, cursor)
        if (!filler) {
          complete = false
          break
        }
        subgroupUnits.push(filler.unit)
        cursor = filler.nextCursor
      }
      if (!complete) break
      subgroups.push(subgroupUnits)
    }

    if (!complete || subgroups.length !== SUBGROUP_COUNT) break
    const selected = subgroups.flat()
    if (selected.length !== WORDS_PER_DECK) break

    decks.push(makeDeck(
      `standard-${String(deckIndex + 1).padStart(3, '0')}`,
      `高频卡组 ${String(deckIndex + 1).padStart(2, '0')}`,
      'standard',
      'L1/L2 主力词与 L3 中频词，按首字母轮转编排',
      selected,
      deckIndex,
    ))
    deckIndex += 1
  }
  return decks
}

export function buildLowFrequencyDecks(cards: CardRecord[], usedIds = new Set<string>()): StudyDeck[] {
  const units = groupIntoUnits(cards)
  const remaining = units
    .filter((unit) => unitCards(unit).every((card) => !usedIds.has(card.cardId)))
    .sort(unitOrder)
  return chunkUnits(remaining, WORDS_PER_DECK).map((chunk, index) => makeDeck(`low-frequency-${String(index + 1).padStart(3, '0')}`, `低频卡组 ${String(index + 1).padStart(2, '0')}`, 'low-frequency', '未纳入普通卡组的剩余词卡，适合集中强化', chunk, 500 + index))
}

export function buildTopicDecks(cards: CardRecord[]): StudyDeck[] {
  const units = groupIntoUnits(cards)
  const decks: StudyDeck[] = []
  let index = 0
  for (const [topicId, topic] of Object.entries(TOPIC_LABELS)) {
    const matches = units.filter((unit) => {
      const meaning = unit.meaning?.meaning ?? unit.spelling?.meaning ?? ''
      return topic.words.has(unitWord(unit)) || topic.meaning.test(meaning)
    })
    chunkUnits(matches.sort(unitOrder), WORDS_PER_DECK).forEach((chunk, chunkIndex) => {
      decks.push(makeDeck(`topic-${topicId}-${String(chunkIndex + 1).padStart(2, '0')}`, `${topic.title} ${chunkIndex + 1}`, 'topic', topic.description, chunk, 800 + index))
      index += 1
    })
  }
  return decks
}

export function buildStudyDecks(cards: CardRecord[]): StudyDeck[] {
  const standard = buildStandardDecks(cards)
  const usedIds = new Set(standard.flatMap((deck) => deck.cardIds))
  return [...standard, ...buildLowFrequencyDecks(cards, usedIds), ...buildTopicDecks(cards)]
}

export function getDeckProgress(deck: StudyDeck, store: LearningStore): { mastered: number; total: number; percent: number } {
  const progress = store.decks[deck.deckId]
  const mastered = progress ? deck.cardIds.filter((cardId) => progress.masteredCardIds.includes(cardId)).length : 0
  return { mastered, total: deck.totalCards, percent: deck.totalCards === 0 ? 0 : Math.round((mastered / deck.totalCards) * 100) }
}

export function getDefaultDeck(decks: StudyDeck[], store: LearningStore): StudyDeck | undefined {
  return decks.find((deck) => getDeckProgress(deck, store).mastered < deck.totalCards) ?? decks[0]
}
