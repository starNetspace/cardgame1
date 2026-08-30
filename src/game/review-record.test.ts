import { describe, expect, it } from 'vitest'
import { getCardMemorySummary, normalizeCardMemoryStore, updateCardMemory } from './review'

describe('card memory records', () => {
  it('does not create a record for a correct unseen card', () => {
    expect(updateCardMemory({}, 'card-1', 'meaning', true, 100)).toEqual({})
  })

  it('creates bronze on a mistake and records abandoned answers', () => {
    const next = updateCardMemory({}, 'card-1', 'spelling', false, 100, true)
    expect(next['card-1']).toMatchObject({ quality: 'bronze', streak: 0, lapses: 1 })
    expect(next['card-1'].history[0]).toMatchObject({ correct: false, abandoned: true, at: 100 })
  })

  it('promotes bronze after three consecutive correct answers', () => {
    let store = updateCardMemory({}, 'card-1', 'meaning', false, 100)
    store = updateCardMemory(store, 'card-1', 'meaning', true, 200)
    store = updateCardMemory(store, 'card-1', 'meaning', true, 300)
    store = updateCardMemory(store, 'card-1', 'meaning', true, 400)
    expect(store['card-1'].quality).toBe('silver')
    expect(store['card-1'].streak).toBe(3)
  })

  it('downgrades quality and retains bounded history after a mistake', () => {
    let store = updateCardMemory({}, 'card-1', 'meaning', false, 100)
    for (let index = 0; index < 105; index += 1) store = updateCardMemory(store, 'card-1', 'meaning', false, index + 200)
    expect(store['card-1'].quality).toBe('bronze')
    expect(store['card-1'].lapses).toBe(106)
    expect(store['card-1'].history).toHaveLength(100)
    expect(store['card-1'].history[0].at).toBe(205)
  })

  it('normalizes malformed records and summarizes valid ones', () => {
    const store = normalizeCardMemoryStore({
      valid: { cardId: 'valid', quality: 'gold', streak: 2, dueAt: 100, history: [], lapses: 3 },
      invalid: { cardId: 'invalid', quality: 'unknown', streak: 0, dueAt: 100, history: [], lapses: 0 },
    })
    expect(Object.keys(store)).toEqual(['valid'])
    expect(getCardMemorySummary(store, 100)).toMatchObject({ total: 1, due: 1, lapses: 3, byQuality: { gold: 1 } })
  })
})
