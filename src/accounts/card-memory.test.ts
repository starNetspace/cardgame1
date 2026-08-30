import { describe, expect, it } from 'vitest'
import { dueCardCount, getDueCardIds, getDueCards, getNextDueAt, normalizeCardMemoryStore, updateCardMemory } from './local-progress'
import type { CardMemoryStore } from '../shared/domain-types'

const DAY = 24 * 60 * 60 * 1000
const rng = () => 0.5

function startOfDay(ms: number): number {
  const date = new Date(ms)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

function dayDiff(now: number, dueAt: number): number {
  return Math.round((startOfDay(dueAt) - startOfDay(now)) / DAY)
}

function at(hour: number, minute = 0): number {
  return new Date(2026, 7, 31, hour, minute, 0, 0).getTime()
}

const NOW = at(10, 0)

function answer(store: CardMemoryStore, cardId: string, correct: boolean, now = NOW, options: Parameters<typeof updateCardMemory>[5] = {}): CardMemoryStore {
  return updateCardMemory(store, cardId, 'meaning', correct, now, { rng, ...options })
}

describe('card memory interval table', () => {
  it('does not create a record for a correct unseen card', () => {
    expect(answer({}, 'card-1', true)).toEqual({})
  })

  it('creates bronze with a same-day due on a mistake', () => {
    const next = answer({}, 'card-1', false)
    expect(next['card-1']).toMatchObject({ quality: 'bronze', streak: 0, lapses: 1 })
    expect(dayDiff(NOW, next['card-1'].dueAt)).toBe(0)
  })

  it('follows the full bronze → silver → gold → mastered progression', () => {
    let store: CardMemoryStore = {}
    store = answer(store, 'c1', false)
    expect(dayDiff(NOW, store['c1'].dueAt)).toBe(0) // 当日稍后

    store = answer(store, 'c1', true)
    expect(store['c1']).toMatchObject({ quality: 'bronze', streak: 1 })
    expect(dayDiff(NOW, store['c1'].dueAt)).toBe(1)

    store = answer(store, 'c1', true)
    expect(store['c1'].streak).toBe(2)
    expect(dayDiff(NOW, store['c1'].dueAt)).toBe(2)

    store = answer(store, 'c1', true)
    expect(store['c1'].streak).toBe(3)
    expect(dayDiff(NOW, store['c1'].dueAt)).toBe(4)

    store = answer(store, 'c1', true) // 连对4 -> silver
    expect(store['c1']).toMatchObject({ quality: 'silver', streak: 0 })
    expect(dayDiff(NOW, store['c1'].dueAt)).toBe(7)

    store = answer(store, 'c1', true)
    expect(store['c1'].streak).toBe(1)
    expect(dayDiff(NOW, store['c1'].dueAt)).toBe(10)

    store = answer(store, 'c1', true)
    expect(dayDiff(NOW, store['c1'].dueAt)).toBe(14)

    store = answer(store, 'c1', true)
    expect(store['c1'].streak).toBe(3)
    expect(dayDiff(NOW, store['c1'].dueAt)).toBe(21)

    store = answer(store, 'c1', true) // 连对4 -> gold
    expect(store['c1']).toMatchObject({ quality: 'gold', streak: 0 })
    expect(dayDiff(NOW, store['c1'].dueAt)).toBe(21)

    store = answer(store, 'c1', true)
    expect(store['c1'].streak).toBe(1)
    expect(dayDiff(NOW, store['c1'].dueAt)).toBe(30)

    store = answer(store, 'c1', true)
    expect(dayDiff(NOW, store['c1'].dueAt)).toBe(45)

    store = answer(store, 'c1', true) // 连对3 -> mastered
    expect(store['c1']).toMatchObject({ quality: 'mastered', streak: 0 })
    expect(dayDiff(NOW, store['c1'].dueAt)).toBe(60)

    store = answer(store, 'c1', true) // 之后恒定 90 天
    expect(store['c1'].quality).toBe('mastered')
    expect(dayDiff(NOW, store['c1'].dueAt)).toBe(90)

    store = answer(store, 'c1', true)
    expect(dayDiff(NOW, store['c1'].dueAt)).toBe(90)

    store = answer(store, 'c1', false) // mastered 答错 -> gold 21 天
    expect(store['c1']).toMatchObject({ quality: 'gold', streak: 0 })
    expect(dayDiff(NOW, store['c1'].dueAt)).toBe(21)
  })

  it('downgrades one level on a mistake and keeps bronze at bronze', () => {
    const gold = normalizeCardMemoryStore({ c: { cardId: 'c', quality: 'gold', streak: 2, dueAt: 100, history: [], lapses: 0 } })
    const fromGold = answer(gold, 'c', false)
    expect(fromGold['c']).toMatchObject({ quality: 'silver', streak: 0 })
    expect(dayDiff(NOW, fromGold['c'].dueAt)).toBe(7)

    const mastered = normalizeCardMemoryStore({ c: { cardId: 'c', quality: 'mastered', streak: 1, dueAt: 100, history: [], lapses: 0 } })
    const fromMastered = answer(mastered, 'c', false)
    expect(fromMastered['c']).toMatchObject({ quality: 'gold', streak: 0 })
    expect(dayDiff(NOW, fromMastered['c'].dueAt)).toBe(21)

    const bronze = normalizeCardMemoryStore({ c: { cardId: 'c', quality: 'bronze', streak: 2, dueAt: 100, history: [], lapses: 0 } })
    const fromBronze = answer(bronze, 'c', false)
    expect(fromBronze['c']).toMatchObject({ quality: 'bronze', streak: 0 })
    expect(dayDiff(NOW, fromBronze['c'].dueAt)).toBe(0)
  })
})

describe('card memory time boundaries', () => {
  it('never schedules earlier than now + 30 minutes', () => {
    const normal = answer({}, 'c', false)
    expect(normal['c'].dueAt).toBeGreaterThanOrEqual(NOW + 30 * 60 * 1000)

    const late = at(23, 55)
    const rolled = updateCardMemory({}, 'c2', 'meaning', false, late, { rng })
    expect(rolled['c2'].dueAt).toBeGreaterThanOrEqual(late + 30 * 60 * 1000)
  })

  it('rolls a late-night same-day due into the next morning 06:00~09:00', () => {
    const late = at(23, 30)
    const store = updateCardMemory({}, 'c', 'meaning', false, late, { rng })
    const dueAt = store['c'].dueAt
    expect(dueAt).toBeGreaterThanOrEqual(late + 30 * 60 * 1000)
    expect(dayDiff(late, dueAt)).toBe(1)
    const hours = new Date(dueAt).getHours()
    expect(hours).toBeGreaterThanOrEqual(6)
    expect(hours).toBeLessThan(9)
  })

  it('does not apply ±10% day jitter to the same-day interval', () => {
    const low = updateCardMemory({}, 'c', 'meaning', false, NOW, { rng: () => 0 })
    const high = updateCardMemory({}, 'c', 'meaning', false, NOW, { rng: () => 1 })
    expect(dayDiff(NOW, low['c'].dueAt)).toBe(0)
    expect(dayDiff(NOW, high['c'].dueAt)).toBe(0)
  })

  it('does not punish overdue cards answered correctly', () => {
    const overdue = NOW - 30 * DAY
    const store = normalizeCardMemoryStore({ c: { cardId: 'c', quality: 'bronze', streak: 1, dueAt: overdue, history: [], lapses: 0 } })
    const after = updateCardMemory(store, 'c', 'meaning', true, NOW, { rng })
    expect(after['c'].streak).toBe(2)
    expect(dayDiff(NOW, after['c'].dueAt)).toBe(2)
  })
})

describe('card memory answer-source accounting', () => {
  it('requeue answers only append history without touching quality/streak/dueAt/lapses', () => {
    const store = normalizeCardMemoryStore({ c: { cardId: 'c', quality: 'gold', streak: 2, dueAt: 500, history: [{ at: 100, correct: false, face: 'meaning', quality: 'gold', streak: 2, dueAt: 500 }], lapses: 1 } })
    const after = updateCardMemory(store, 'c', 'meaning', false, NOW, { rng, source: 'requeue' })
    expect(after['c']).toMatchObject({ quality: 'gold', streak: 2, dueAt: 500, lapses: 1 })
    expect(after['c'].history).toHaveLength(2)
  })

  it('only accumulates lapses through the due channel', () => {
    let store = normalizeCardMemoryStore({ c: { cardId: 'c', quality: 'bronze', streak: 0, dueAt: 500, history: [], lapses: 0 } })
    store = updateCardMemory(store, 'c', 'meaning', false, NOW, { rng, source: 'requeue' })
    store = updateCardMemory(store, 'c', 'meaning', false, NOW, { rng, source: 'requeue' })
    expect(store['c'].lapses).toBe(0)
    store = updateCardMemory(store, 'c', 'meaning', false, NOW, { rng, source: 'due' })
    expect(store['c'].lapses).toBe(1)
  })
})

describe('card memory migration and due queries', () => {
  it('truncates an oversized streak without re-promoting or demoting', () => {
    const store = normalizeCardMemoryStore({ c: { cardId: 'c', quality: 'bronze', streak: 99, dueAt: 100, history: [], lapses: 0 } })
    expect(store['c'].streak).toBe(3)
    expect(store['c'].quality).toBe('bronze')
  })

  it('lists due cards earliest-first and applies limits', () => {
    const store = normalizeCardMemoryStore({
      a: { cardId: 'a', quality: 'bronze', streak: 0, dueAt: 300, history: [], lapses: 0 },
      b: { cardId: 'b', quality: 'bronze', streak: 0, dueAt: 100, history: [], lapses: 0 },
      c: { cardId: 'c', quality: 'bronze', streak: 0, dueAt: 200, history: [], lapses: 0 },
      d: { cardId: 'd', quality: 'silver', streak: 0, dueAt: 9999, history: [], lapses: 0 },
    })
    expect(getDueCardIds(store, 400)).toEqual(['b', 'c', 'a'])
    expect(getDueCards(store, 400)).toEqual(['b', 'c', 'a'])
    expect(getDueCards(store, 400, 2)).toEqual(['b', 'c'])
    expect(dueCardCount(store, 400)).toBe(3)
    expect(getNextDueAt(store, 400)).toBe(9999)
  })
})
