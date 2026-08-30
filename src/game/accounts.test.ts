import { beforeEach, describe, expect, it } from 'vitest'
import { createAccount, createAccountExport, deleteAccount, importAccountData, loadAccountRegistry, parseAccountExport, switchAccount } from './accounts'
import { createBattle } from './rules'
import { getActiveUsername, loadBattleStore, loadLearningStore, loadReviewStore, saveBattleState, saveLearningStore, saveReviewStore, setActiveUsername, updateLearningMemory, updateReview } from './review'
import type { AccountExport, LearningStore } from '../types'

function installStorage() {
  const values = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  })
}

function emptyLearning(): LearningStore {
  return { decks: {}, cards: {} }
}

describe('account management and portable data', () => {
  beforeEach(() => {
    installStorage()
    setActiveUsername('default')
  })

  it('creates, switches, and protects the default account', () => {
    const initial = loadAccountRegistry()
    const created = createAccount(initial, '  Alice  ', 100)
    expect(created?.activeUsername).toBe('Alice')
    expect(getActiveUsername()).toBe('Alice')
    expect(switchAccount(created!, 'default', 200)?.activeUsername).toBe('default')
    expect(deleteAccount(created!, 'default')).toEqual(created)
  })

  it('keeps review, learning, and battles isolated by username', () => {
    let registry = loadAccountRegistry()
    registry = createAccount(registry, 'Alice', 100)!
    const learning = updateLearningMemory(emptyLearning(), 'deck-a', 'card-a', false, 101)
    saveReviewStore(updateReview({}, 'card-a', 'meaning', false), 'Alice')
    saveLearningStore(learning, 'Alice')
    const battle = createBattle([], [])
    saveBattleState('practice', battle, 'Alice')

    registry = switchAccount(registry, 'default', 200)!
    expect(loadReviewStore()).toEqual({})
    expect(loadLearningStore()).toEqual(emptyLearning())
    expect(loadBattleStore()).toEqual({})

    registry = switchAccount(registry, 'Alice', 300)!
    expect(Object.keys(loadReviewStore())).toEqual(['card-a'])
    expect(loadLearningStore().cards['deck-a|card-a']).toMatchObject({ incorrectCount: 1 })
    expect(loadBattleStore().practice?.status).toBe('playing')
  })

  it('exports and imports all account data, including multiple learning残局 slots', () => {
    let registry = loadAccountRegistry()
    registry = createAccount(registry, 'Alice', 100)!
    const review = updateReview({}, 'card-a', 'meaning', false)
    const learning = updateLearningMemory(emptyLearning(), 'deck-a', 'card-a', false, 101)
    saveReviewStore(review, 'Alice')
    saveLearningStore(learning, 'Alice')
    const first = createBattle([], [], 'learning')
    first.learningDeckId = 'deck-a'
    const second = createBattle([], [], 'learning')
    second.learningDeckId = 'deck-b'
    saveBattleState('learning', first, 'Alice')
    saveBattleState('learning', second, 'Alice')

    const exported = createAccountExport('Alice', 500)
    expect(exported).not.toHaveProperty('password')
    const parsed = parseAccountExport(JSON.parse(JSON.stringify(exported)))
    expect(parsed?.username).toBe('Alice')

    registry = switchAccount(registry, 'default', 600)!
    const imported = importAccountData(registry, parsed as AccountExport, true, 700)!
    expect(imported.activeUsername).toBe('Alice')
    expect(loadReviewStore('Alice')['card-a']).toMatchObject({ incorrect: 1 })
    expect(Object.keys(loadBattleStore('Alice').learning ?? {}).sort()).toEqual(['deck-a', 'deck-b'])
    switchAccount(imported, 'default', 800)
    expect(loadReviewStore()['card-a']).toBeUndefined()
  })

  it('deletes a non-default account and its stored records', () => {
    const registry = createAccount(loadAccountRegistry(), 'Alice', 100)!
    saveReviewStore(updateReview({}, 'card-a', 'meaning', false), 'Alice')
    const remaining = deleteAccount(registry, 'Alice')
    expect(remaining.accounts.Alice).toBeUndefined()
    expect(loadReviewStore('Alice')).toEqual({})
    expect(loadLearningStore('Alice')).toEqual(emptyLearning())
    expect(loadBattleStore('Alice')).toEqual({})
  })
})
