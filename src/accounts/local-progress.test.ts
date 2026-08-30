import { beforeEach, describe, expect, it } from 'vitest'
import { getLearningMistakes, getReviewMistakes, getTodayLearnedCount, isValidMistakePracticeCount, limitMistakeIds, loadBattleStore, resetDeckLearningMemory, saveBattleState, saveLearningBattleState, updateLearningMemory, updateReview } from './local-progress'
import { createBattle } from '../battle/battle-rules'
import type { LearningStore } from '../shared/domain-types'

const DAY = 24 * 60 * 60 * 1000

function emptyStore(): LearningStore {
  return { decks: {}, cards: {} }
}

describe('learning memory', () => {
  it('records correct and incorrect answers independently per deck and card', () => {
    const first = updateLearningMemory(emptyStore(), 'standard-001', 'card-1', false, 100)
    const second = updateLearningMemory(first, 'standard-001', 'card-1', true, 200)
    const topic = updateLearningMemory(second, 'topic-months-01', 'card-1', true, 300)

    expect(topic.cards['standard-001|card-1']).toMatchObject({ correctCount: 1, incorrectCount: 1, lastIncorrectAt: 100 })
    expect(topic.cards['topic-months-01|card-1']).toMatchObject({ correctCount: 1, incorrectCount: 0 })
    expect(topic.decks['standard-001'].masteredCardIds).toEqual(['card-1'])
    expect(topic.decks['topic-months-01'].masteredCardIds).toEqual(['card-1'])
  })

  it('deduplicates today learned cards across overlapping decks', () => {
    const now = Date.UTC(2026, 7, 29, 12)
    let store = updateLearningMemory(emptyStore(), 'standard-001', 'card-1', true, now)
    store = updateLearningMemory(store, 'topic-months-01', 'card-1', true, now + 1)
    store = updateLearningMemory(store, 'standard-001', 'card-2', true, now + 2)
    store = updateLearningMemory(store, 'standard-001', 'card-3', true, now - DAY)

    expect(getTodayLearnedCount(store, now)).toBe(2)
  })

  it('returns learning mistakes by latest error and can reset one deck only', () => {
    let store = updateLearningMemory(emptyStore(), 'standard-001', 'card-1', false, 100)
    store = updateLearningMemory(store, 'topic-months-01', 'card-2', false, 300)
    store = updateLearningMemory(store, 'standard-001', 'card-3', false, 200)
    const mistakes = getLearningMistakes(store)
    expect(mistakes.map((item) => item.cardId)).toEqual(['card-2', 'card-3', 'card-1'])

    const reset = resetDeckLearningMemory(store, 'standard-001')
    expect(Object.keys(reset.cards)).toEqual(['topic-months-01|card-2'])
    expect(reset.decks['standard-001']).toBeUndefined()
    expect(reset.decks['topic-months-01']).toBeDefined()
  })

  it('removes a learning mistake after three consecutive correct answers', () => {
    let store = updateLearningMemory(emptyStore(), 'standard-001', 'card-1', false, 100)
    store = updateLearningMemory(store, 'standard-001', 'card-1', true, 200)
    store = updateLearningMemory(store, 'standard-001', 'card-1', true, 300)
    store = updateLearningMemory(store, 'standard-001', 'card-1', true, 400)
    expect(getLearningMistakes(store)).toHaveLength(0)
  })

  it('removes a practice mistake after three consecutive correct answers', () => {
    let store = updateReview({}, 'card-1', 'meaning', false)
    store = updateReview(store, 'card-1', 'meaning', true)
    store = updateReview(store, 'card-1', 'meaning', true)
    store = updateReview(store, 'card-1', 'meaning', true)
    expect(getReviewMistakes(store)).toHaveLength(0)
  })

  it('limits mistake practice to a positive count and keeps all mistakes when unset', () => {
    const ids = ['card-1', 'card-2', 'card-3']
    expect(limitMistakeIds(ids, 2)).toEqual(['card-1', 'card-2'])
    expect(limitMistakeIds(ids)).toEqual(ids)
    expect(limitMistakeIds(ids, 0)).toEqual(ids)
  })

  it('requires at least ten available mistakes and allows larger requested counts', () => {
    expect(isValidMistakePracticeCount(9)).toBe(false)
    expect(isValidMistakePracticeCount(10)).toBe(true)
    expect(isValidMistakePracticeCount(20, 9)).toBe(false)
    expect(isValidMistakePracticeCount(20, 10)).toBe(true)
    expect(isValidMistakePracticeCount(10, 99)).toBe(true)
    expect(isValidMistakePracticeCount(20, 10.5)).toBe(false)
  })
})

describe('learning storage recovery', () => {
  beforeEach(() => {
    const values = new Map<string, string>()
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
    })
  })

  it('ignores malformed learning records', async () => {
    localStorage.setItem('lexicon-duel-learning-v1', '{broken')
    const { loadLearningStore } = await import('./local-progress')
    expect(loadLearningStore()).toEqual({ decks: {}, cards: {} })
  })

  it('does not keep a defeated battle as a resumable save', () => {
    const battle = createBattle([], [])
    battle.status = 'defeat'
    saveBattleState('practice', battle)
    expect(loadBattleStore()).toEqual({})
  })

  it('does not save a battle whose current enemy is already defeated', () => {
    const battle = createBattle([], [])
    battle.enemy.hp = 0
    saveBattleState('practice', battle)
    expect(loadBattleStore()).toEqual({})
  })

  it('does not place an incomplete learning battle in another mode slot', () => {
    const battle = createBattle([], [], 'learning')
    saveBattleState('learning', battle)
    expect(loadBattleStore()).toEqual({})
  })

  it('clears defeated learning battles through the dedicated save helper', () => {
    const battle = createBattle([], [], 'learning')
    battle.learningDeckId = 'deck-a'
    saveLearningBattleState('deck-a', battle)
    expect(loadBattleStore().learning?.['deck-a']).toBeDefined()

    battle.status = 'defeat'
    saveLearningBattleState('deck-a', battle)
    expect(loadBattleStore()).toEqual({})
  })
})
