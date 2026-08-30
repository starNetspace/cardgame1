import { describe, expect, it } from 'vitest'
import { buildLowFrequencyDecks, buildStandardDecks, buildStudyDecks, buildTopicDecks, getDeckProgress } from './decks'
import type { CardRecord, LearningStore } from '../types'

function card(index: number, level: 1 | 2 | 3 | 4 | 5, word = `word${index}`, meaning = `释义${index}`): CardRecord {
  return { cardId: `card-${index}`, word, phonetic: '', pos: 'n', meaning, frequencyLevel: level, frequencyLabel: `L${level}`, effectType: 'shield' }
}

function balancedCards(count = 40): CardRecord[] {
  const highCount = Math.min(50, count)
  const middleCount = Math.min(10, Math.max(0, count - highCount))
  const lowCount = Math.max(0, count - highCount - middleCount)
  return [
    ...Array.from({ length: highCount }, (_, index) => card(index, index % 2 ? 1 : 2, `${String.fromCharCode(97 + (index % 10))}high${index}`)),
    ...Array.from({ length: middleCount }, (_, index) => card(100 + index, 3, `${String.fromCharCode(107 + (index % 10))}middle${index}`)),
    ...Array.from({ length: lowCount }, (_, index) => card(200 + index, 4, `${String.fromCharCode(117 + (index % 6))}low${index}`)),
  ]
}

describe('study deck generation', () => {
  it('creates 30-card standard decks with five six-card subgroups and quotas', () => {
    const decks = buildStandardDecks(balancedCards(60))
    expect(decks.length).toBe(2)
    for (const deck of decks) {
      expect(deck.cardIds).toHaveLength(30)
      expect(deck.subgroups).toHaveLength(5)
      expect(deck.subgroups.every((part) => part.cardIds.length > 0)).toBe(true)
      expect(deck.subgroups.every((part) => part.cardIds.length === 6)).toBe(true)
      const deckCards = deck.cardIds.map((id) => balancedCards(60).find((item) => item.cardId === id)!)
      expect(deckCards.filter((item) => item.frequencyLevel <= 2).length).toBeGreaterThanOrEqual(15)
      expect(deckCards.filter((item) => item.frequencyLevel === 3).length).toBeGreaterThanOrEqual(5)
      expect(deck.subgroups.every((part) => part.cardIds.filter((id) => deckCards.find((item) => item.cardId === id && item.frequencyLevel <= 2)).length >= 3)).toBe(true)
    }
  })

  it('keeps a final low-frequency group below thirty cards', () => {
    const cards = balancedCards(67)
    const standard = buildStandardDecks(cards)
    const used = new Set(standard.flatMap((deck) => deck.cardIds))
    const low = buildLowFrequencyDecks(cards, used)
    expect(low.length).toBeGreaterThan(0)
    expect(low[low.length - 1].totalCards).toBeLessThanOrEqual(30)
  })

  it('recognizes topics without removing cards from standard decks', () => {
    const cards = [
      ...balancedCards(57),
      card(100, 1, 'January', '一月'),
      card(101, 2, 'China', '中国'),
      card(102, 3, 'rain', '雨；天气'),
    ]
    const topics = buildTopicDecks(cards)
    const allTopicIds = new Set(topics.flatMap((deck) => deck.cardIds))
    expect(allTopicIds.has('card-100')).toBe(true)
    expect(allTopicIds.has('card-101')).toBe(true)
    expect(allTopicIds.has('card-102')).toBe(true)
    const all = buildStudyDecks(cards)
    const standardIds = new Set(all.filter((deck) => deck.category === 'standard').flatMap((deck) => deck.cardIds))
    expect([...allTopicIds].some((id) => standardIds.has(id))).toBe(true)
  })

  it('calculates progress from mastered cards in the selected deck', () => {
    const deck = buildStandardDecks([
      ...balancedCards(30),
      ...Array.from({ length: 5 }, (_, index) => card(300 + index, 3, `middle-extra${index}`)),
    ])[0]
    const store: LearningStore = { decks: { [deck.deckId]: { deckId: deck.deckId, masteredCardIds: deck.cardIds.slice(0, 3), studySessions: 1, lastStudiedAt: 1, lastCompletedAt: 0 } }, cards: {} }
    expect(getDeckProgress(deck, store)).toEqual({ mastered: 3, total: 30, percent: 10 })
  })
})
