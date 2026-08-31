import { describe, expect, it } from 'vitest'
import { buildLowFrequencyDecks, buildStandardDecks, buildStudyDecks, buildTopicDecks, getDeckProgress } from './study-decks'
import { cleanCardRecords } from './card-library'
import type { CardRecord, LearningStore } from '../shared/domain-types'

function cardPair(index: number, level: 1 | 2 | 3 | 4 | 5, word = `word${index}`, meaning = `释义${index}`): CardRecord[] {
  const base = { word, phonetic: '', pos: 'n', meaning, frequencyLevel: level, frequencyLabel: `L${level}`, effectType: 'shield' as const }
  return [
    { ...base, cardId: `card-${index}`, face: 'meaning' as const },
    { ...base, cardId: `card-${index}-spelling`, face: 'spelling' as const },
  ]
}

// `wordCount` distinct word units; each unit expands to a meaning + spelling card.
function balancedCards(wordCount = 40): CardRecord[] {
  const highCount = Math.min(50, wordCount)
  const middleCount = Math.min(10, Math.max(0, wordCount - highCount))
  const lowCount = Math.max(0, wordCount - highCount - middleCount)
  return [
    ...Array.from({ length: highCount }, (_, index) => cardPair(index, index % 2 ? 1 : 2, `${String.fromCharCode(97 + (index % 10))}high${index}`)),
    ...Array.from({ length: middleCount }, (_, index) => cardPair(100 + index, 3, `${String.fromCharCode(107 + (index % 10))}middle${index}`)),
    ...Array.from({ length: lowCount }, (_, index) => cardPair(200 + index, 4, `${String.fromCharCode(117 + (index % 6))}low${index}`)),
  ].flat()
}

describe('study deck generation', () => {
  it('creates 60-card standard decks from 30-word units with five six-word subgroups and quotas', () => {
    const decks = buildStandardDecks(balancedCards(60))
    expect(decks.length).toBe(2)
    for (const deck of decks) {
      expect(deck.cardIds).toHaveLength(60)
      expect(deck.totalCards).toBe(60)
      expect(deck.subgroups).toHaveLength(5)
      expect(deck.subgroups.every((part) => part.cardIds.length === 12)).toBe(true)
      const deckCards = deck.cardIds.map((id) => balancedCards(60).find((item) => item.cardId === id)!)
      expect(deckCards.filter((item) => item.frequencyLevel <= 2).length).toBeGreaterThanOrEqual(30)
      expect(deckCards.filter((item) => item.frequencyLevel === 3).length).toBeGreaterThanOrEqual(10)
      // Every word+pos in the deck appears as exactly one meaning and one spelling card.
      expect(deckCards.filter((item) => item.face === 'meaning')).toHaveLength(30)
      expect(deckCards.filter((item) => item.face === 'spelling')).toHaveLength(30)
      expect(deck.subgroups.every((part) => part.cardIds.filter((id) => deckCards.find((item) => item.cardId === id && item.frequencyLevel <= 2)).length >= 6)).toBe(true)
    }
  })

  it('keeps a final low-frequency group below sixty cards', () => {
    const cards = balancedCards(67)
    const standard = buildStandardDecks(cards)
    const used = new Set(standard.flatMap((deck) => deck.cardIds))
    const low = buildLowFrequencyDecks(cards, used)
    expect(low.length).toBeGreaterThan(0)
    expect(low[low.length - 1].totalCards).toBeLessThanOrEqual(60)
  })

  it('recognizes topics without removing cards from standard decks', () => {
    const cards = [
      ...balancedCards(57),
      ...cardPair(400, 1, 'January', '一月'),
      ...cardPair(401, 2, 'China', '中国'),
      ...cardPair(402, 3, 'rain', '雨；天气'),
    ]
    const topics = buildTopicDecks(cards)
    const allTopicIds = new Set(topics.flatMap((deck) => deck.cardIds))
    expect(allTopicIds.has('card-400')).toBe(true)
    expect(allTopicIds.has('card-400-spelling')).toBe(true)
    expect(allTopicIds.has('card-401')).toBe(true)
    expect(allTopicIds.has('card-402')).toBe(true)
    const all = buildStudyDecks(cards)
    const nonTopicIds = new Set(all.filter((deck) => deck.category !== 'topic').flatMap((deck) => deck.cardIds))
    for (const id of allTopicIds) {
      expect(nonTopicIds.has(id)).toBe(true)
    }
  })

  it('calculates progress from mastered cards in the selected deck', () => {
    const deck = buildStandardDecks(balancedCards(60))[0]
    const store: LearningStore = { decks: { [deck.deckId]: { deckId: deck.deckId, masteredCardIds: deck.cardIds.slice(0, 3), studySessions: 1, lastStudiedAt: 1, lastCompletedAt: 0 } }, cards: {} }
    expect(getDeckProgress(deck, store)).toEqual({ mastered: 3, total: 60, percent: 5 })
  })
})

describe('word split coverage', () => {
  it('every word+pos appears as both a meaning and spelling card across all decks', () => {
    const cards = cleanCardRecords([
      { cardId: 'a', word: 'abandon', phonetic: '', pos: 'v', meaning: '放弃', frequencyLevel: 2 },
      { cardId: 'b', word: 'ability', phonetic: '', pos: 'n', meaning: '能力', frequencyLevel: 3 },
      { cardId: 'c', word: 'able', phonetic: '', pos: 'adj', meaning: '有能力的', frequencyLevel: 1 },
      { cardId: 'd', word: 'abroad', phonetic: '', pos: 'adv', meaning: '在国外', frequencyLevel: 4 },
      { cardId: 'e', word: 'after', phonetic: '', pos: 'conj', meaning: '之后', frequencyLevel: 5 },
      { cardId: 'f', word: 'build', phonetic: '', pos: 'v', meaning: '建造', frequencyLevel: 1 },
      { cardId: 'g', word: 'carry', phonetic: '', pos: 'v', meaning: '携带', frequencyLevel: 1 },
      { cardId: 'h', word: 'decide', phonetic: '', pos: 'v', meaning: '决定', frequencyLevel: 1 },
      { cardId: 'i', word: 'explain', phonetic: '', pos: 'v', meaning: '解释', frequencyLevel: 1 },
    ])

    // Each raw entry must split into exactly one meaning and one spelling card.
    expect(cards).toHaveLength(18)
    for (const raw of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']) {
      const pair = cards.filter((item) => item.cardId === raw || item.cardId === `${raw}-spelling`)
      expect(pair.map((item) => item.face).sort()).toEqual(['meaning', 'spelling'])
    }

    // Across all decks, both faces of every word+pos must be present.
    const decks = buildStudyDecks(cards)
    const allIds = new Set(decks.flatMap((deck) => deck.cardIds))
    for (const card of cards) {
      expect(allIds.has(card.cardId)).toBe(true)
    }
  })

  it('keeps meaning and spelling ids distinct and stable', () => {
    const cards = cleanCardRecords([
      { cardId: 'w1', word: 'record', phonetic: '', pos: 'n', meaning: '记录', frequencyLevel: 2 },
    ])
    expect(cards.map((item) => item.cardId)).toEqual(['w1', 'w1-spelling'])
    expect(cards.map((item) => item.face)).toEqual(['meaning', 'spelling'])
  })
})
