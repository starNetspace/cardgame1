import type { CardRecord, LearningStore, StudyDeck, StudyDeckCategory, StudySubgroup } from '../types'

const GROUP_SIZE = 30
const SUBGROUP_COUNT = 5
const SUBGROUP_SIZE = 6
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

function wordKey(card: CardRecord): string {
  return card.word.trim().toLowerCase()
}

function firstLetter(card: CardRecord): string {
  return wordKey(card).match(/[a-z]/)?.[0] ?? 'z'
}

function cardOrder(a: CardRecord, b: CardRecord): number {
  return wordKey(a).localeCompare(wordKey(b)) || a.cardId.localeCompare(b.cardId)
}

function rotatePick(pool: CardRecord[], cursor: string): { card: CardRecord; nextCursor: string } | null {
  if (pool.length === 0) return null
  const sorted = [...pool].sort(cardOrder)
  const start = sorted.findIndex((card) => firstLetter(card) >= cursor)
  const index = start < 0 ? 0 : start
  const card = sorted[index]
  const letter = firstLetter(card)
  const nextCursor = String.fromCharCode(letter.charCodeAt(0) + 1)
  return { card, nextCursor: nextCursor > 'z' ? 'a' : nextCursor }
}

function takeRotating(pool: CardRecord[], cursor: string): { card: CardRecord; nextCursor: string } | null {
  const picked = rotatePick(pool, cursor)
  if (!picked) return null
  const index = pool.findIndex((item) => item.cardId === picked.card.cardId)
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

function makeSubgroups(cards: CardRecord[], deckIndex: number): StudySubgroup[] {
  return Array.from({ length: SUBGROUP_COUNT }, (_, index) => {
    const start = index * SUBGROUP_SIZE
    const subgroupCards = seededShuffle(cards.slice(start, start + SUBGROUP_SIZE), deckIndex * 17 + index)
    return { subgroupId: `part-${index + 1}`, title: `小组 ${String(index + 1).padStart(2, '0')}`, cardIds: subgroupCards.map((card) => card.cardId) }
  })
}

function makeDeck(deckId: string, title: string, category: StudyDeckCategory, description: string, cards: CardRecord[], deckIndex: number): StudyDeck {
  const shuffled = seededShuffle(cards, deckIndex + 101)
  return { deckId, title, category, description, cardIds: shuffled.map((card) => card.cardId), subgroups: makeSubgroups(cards, deckIndex), totalCards: shuffled.length }
}

export function chunkCards(cards: CardRecord[], size: number): CardRecord[][] {
  if (size <= 0) return []
  const result: CardRecord[][] = []
  for (let index = 0; index < cards.length; index += size) result.push(cards.slice(index, index + size))
  return result
}

export function buildStandardDecks(cards: CardRecord[]): StudyDeck[] {
  const highPool = cards.filter((card) => HIGH_LEVELS.has(card.frequencyLevel))
  const middlePool = cards.filter((card) => card.frequencyLevel === 3)
  const lowPool = cards.filter((card) => card.frequencyLevel >= 4)
  const decks: StudyDeck[] = []
  let deckIndex = 0
  let cursor = 'a'

  while (highPool.length >= 15 && middlePool.length >= 5) {
    if (highPool.length + middlePool.length + lowPool.length < GROUP_SIZE) break
    const subgroups: CardRecord[][] = []
    for (let subgroup = 0; subgroup < SUBGROUP_COUNT; subgroup += 1) {
      const subgroupCards: CardRecord[] = []
      for (let count = 0; count < 3; count += 1) {
        const picked = takeRotating(highPool, cursor)
        if (!picked) return decks
        subgroupCards.push(picked.card)
        cursor = picked.nextCursor
      }
      const picked = takeRotating(middlePool, cursor)
      if (!picked) return decks
      subgroupCards.push(picked.card)
      cursor = picked.nextCursor
      for (let count = subgroupCards.length; count < SUBGROUP_SIZE; count += 1) {
        const filler = takeRotating(highPool, cursor) ?? takeRotating(middlePool, cursor) ?? takeRotating(lowPool, cursor)
        if (!filler) break
        subgroupCards.push(filler.card)
        cursor = filler.nextCursor
      }
      subgroups.push(subgroupCards)
    }
    const selected = subgroups.flat()
    while (selected.length < GROUP_SIZE) {
      const picked = takeRotating(highPool, cursor) ?? takeRotating(middlePool, cursor) ?? takeRotating(lowPool, cursor)
      if (!picked) break
      selected.push(picked.card)
      cursor = picked.nextCursor
    }
    decks.push(makeDeck(`standard-${String(deckIndex + 1).padStart(3, '0')}`, `高频卡组 ${String(deckIndex + 1).padStart(2, '0')}`, 'standard', 'L1/L2 主力词与 L3 中频词，按首字母轮转编排', selected, deckIndex))
    deckIndex += 1
  }
  return decks
}

export function buildLowFrequencyDecks(cards: CardRecord[], usedIds = new Set<string>()): StudyDeck[] {
  const remaining = cards.filter((card) => !usedIds.has(card.cardId)).sort(cardOrder)
  return chunkCards(remaining, GROUP_SIZE).map((chunk, index) => makeDeck(`low-frequency-${String(index + 1).padStart(3, '0')}`, `低频卡组 ${String(index + 1).padStart(2, '0')}`, 'low-frequency', 'L4/L5 低频词汇，适合集中强化', chunk, 500 + index))
}

export function buildTopicDecks(cards: CardRecord[]): StudyDeck[] {
  const decks: StudyDeck[] = []
  let index = 0
  for (const [topicId, topic] of Object.entries(TOPIC_LABELS)) {
    const matches = cards.filter((card) => topic.words.has(wordKey(card)) || topic.meaning.test(card.meaning))
    chunkCards(matches.sort(cardOrder), GROUP_SIZE).forEach((chunk, chunkIndex) => {
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
