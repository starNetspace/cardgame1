import { describe, expect, it } from 'vitest'
import { chooseCampaignEnemies, getCardWeight, getLearningCardWeight, isCampaignConfig, isCharacterDefinition, isEnemyDefinition } from './card-library'
import type { CampaignConfig, CardRecord, LearningStore, ReviewRecord, ReviewStore } from '../shared/domain-types'

const card: CardRecord = {
  cardId: 'card-1', word: 'abandon', phonetic: '', pos: 'v', meaning: '放弃',
  frequencyLevel: 2, frequencyLabel: 'L2', effectType: 'attack',
}

function record(overrides: Partial<ReviewRecord>): ReviewRecord {
  return { cardId: card.cardId, attempts: 1, correct: 0, incorrect: 0, streak: 0, lastSeenAt: 1_000_000, lastFace: 'meaning', lastCorrect: false, ...overrides }
}

describe('practice card weights', () => {
  const now = 1_000_000

  it('starts at the unseen baseline and lowers after correct answers', () => {
    expect(getCardWeight(card, {}, now)).toBe(4)
    expect(getCardWeight(card, { [card.cardId]: record({ correct: 3, incorrect: 0, lastCorrect: true }) }, now)).toBeLessThan(4)
  })

  it('uses gentle first-to-third error increases and a significant fourth-error increase', () => {
    const weight = (incorrect: number) => getCardWeight(card, { [card.cardId]: record({ incorrect, attempts: incorrect, lastCorrect: false }) }, now)
    expect(weight(1)).toBeCloseTo(5.1)
    expect(weight(2)).toBeCloseTo(5.4)
    expect(weight(3)).toBeCloseTo(6)
    expect(weight(4)).toBeCloseTo(8)
    expect(weight(4) - weight(3)).toBeGreaterThan(weight(2) - weight(1))
  })

  it('keeps repeated errors bounded and preserves a positive floor', () => {
    const high: ReviewStore = { [card.cardId]: record({ incorrect: 100, attempts: 100 }) }
    const low: ReviewStore = { [card.cardId]: record({ correct: 100, incorrect: 0, attempts: 100, lastCorrect: true }) }
    expect(getCardWeight(card, high, now)).toBeLessThan(10)
    expect(getCardWeight(card, low, now)).toBeGreaterThanOrEqual(0.5)
  })
})

const campaign: CampaignConfig = {
  version: 1,
  practice: { sets: [{ id: 'set-a', title: 'A', description: 'A route', enemies: [
    { id: 'one', name: 'ONE', subtitle: '一号', icon: 'eye', maxHp: 20, attack: 2, shield: 0, abilities: [] },
    { id: 'two', name: 'TWO', subtitle: '二号', icon: 'crown', maxHp: 30, attack: 3, shield: 1, abilities: [], isFinal: true },
  ] }] },
  learning: { sets: [{ id: 'learn-a', title: 'Learn', description: 'A learning route', enemies: [
    { id: 'three', name: 'THREE', subtitle: '三号', icon: 'flame', maxHp: 24, attack: 2, shield: 0, abilities: [], isFinal: true },
  ] }] },
}

describe('campaign configuration', () => {
  it('accepts a valid config and returns complete ordered routes', () => {
    expect(isCampaignConfig(campaign)).toBe(true)
    const route = chooseCampaignEnemies(campaign, 'practice', 'set', () => 0)
    expect(route.setId).toBe('set-a')
    expect(route.enemies.map((enemy) => enemy.id)).toEqual(['one', 'two'])
    expect(route.enemies.at(-1)?.isFinal).toBe(true)
  })

  it('returns at most five distinct enemies for an all-enemies route', () => {
    const many: CampaignConfig = { ...campaign, practice: { sets: [{ ...campaign.practice.sets[0], enemies: Array.from({ length: 7 }, (_, index) => ({
      id: `enemy-${index}`, name: `ENEMY ${index}`, subtitle: `${index}`, icon: 'eye' as const, maxHp: 10 + index, attack: 1, shield: 0, abilities: [],
    })) }] } }
    const route = chooseCampaignEnemies(many, 'practice', 'all', () => 0)
    expect(route.enemies).toHaveLength(5)
    expect(new Set(route.enemies.map((enemy) => enemy.id)).size).toBe(5)
    expect(route.enemies.at(-1)?.isFinal).toBe(true)
  })

  it('rejects invalid icons, abilities, values, and final markers', () => {
    expect(isEnemyDefinition({ ...campaign.practice.sets[0].enemies[0], icon: 'unknown' })).toBe(false)
    expect(isEnemyDefinition({ ...campaign.practice.sets[0].enemies[0], maxHp: 0 })).toBe(false)
    expect(isEnemyDefinition({ ...campaign.practice.sets[0].enemies[0], attack: -1 })).toBe(false)
    expect(isEnemyDefinition({ ...campaign.practice.sets[0].enemies[0], shield: -1 })).toBe(false)
    expect(isEnemyDefinition({ ...campaign.practice.sets[0].enemies[0], abilities: [{ type: 'custom', amount: 1, description: 'bad' }] })).toBe(false)
    expect(isCampaignConfig({ ...campaign, practice: { sets: [{ ...campaign.practice.sets[0], enemies: [] }] } })).toBe(false)
    expect(isCampaignConfig({ ...campaign, practice: { sets: [{ ...campaign.practice.sets[0], enemies: [{ ...campaign.practice.sets[0].enemies[0], isFinal: true }, campaign.practice.sets[0].enemies[1]] }] } })).toBe(false)
  })

  it('accepts enemy and character definitions without the legacy icon field', () => {
    expect(isEnemyDefinition({ id: 'legacy', name: 'LEGACY', subtitle: '旧配置', maxHp: 20, attack: 1, shield: 0, abilities: [] })).toBe(true)
    expect(isCharacterDefinition({ id: 'hero', name: 'HERO', subtitle: '英雄', maxHp: 30, shield: 0, abilities: [] })).toBe(true)
  })
})

describe('learning card weights', () => {
  const learning: LearningStore = { decks: {}, cards: {} }
  const pending = { [card.cardId]: 1 }

  it('prioritizes cards with more previous errors and recent incorrect answers', () => {
    const older = getLearningCardWeight(card, learning, 'deck-a', pending, { [card.cardId]: 1_000 }, 1_000 + 10 * 60 * 1000)
    const recent = getLearningCardWeight(card, learning, 'deck-a', pending, { [card.cardId]: 1_000 + 9 * 60 * 1000 }, 1_000 + 10 * 60 * 1000)
    expect(recent).toBeGreaterThan(older)

    const withErrors: LearningStore = { ...learning, cards: { 'deck-a|card-1': { deckId: 'deck-a', cardId: 'card-1', correctCount: 0, incorrectCount: 3, lastAnsweredAt: 0, lastCorrectAt: 0, lastIncorrectAt: 0 } } }
    expect(getLearningCardWeight(card, withErrors, 'deck-a', pending, {}, Date.now())).toBeGreaterThan(getLearningCardWeight(card, learning, 'deck-a', pending, {}, Date.now()))
  })
})
