import { describe, expect, it } from 'vitest'
import { cleanCardRecords, drawCards, makeRuntimeCards } from './data'
import { buildMeaningQuestion, isSpellingCorrect } from './questions'
import { addPlayerShield, advanceCampaignEnemy, applyCardEffect, canCompleteLearningDeck, createBattle, drawTurnCards, enemyAttack, finishEnemyTurn, markLearningCardCorrect, protectLearningBattle, returnLearningCardToQueue, useCharacterAbility } from './rules'
import type { CharacterDefinition, EnemyDefinition, RuntimeCard } from '../types'

const cards = cleanCardRecords([
  { cardId: 'a', word: 'abandon', phonetic: '', pos: 'v', meaning: '放弃；(Abandon)人名', frequencyLevel: 2, frequencyLabel: '较高频' },
  { cardId: 'b', word: 'ability', phonetic: '', pos: 'n', meaning: '能力', frequencyLevel: 3, frequencyLabel: '中频' },
  { cardId: 'c', word: 'able', phonetic: '', pos: 'adj', meaning: '有能力的', frequencyLevel: 1, frequencyLabel: '高频' },
  { cardId: 'd', word: 'abroad', phonetic: '', pos: 'adv', meaning: '在国外', frequencyLevel: 4, frequencyLabel: '低频' },
  { cardId: 'e', word: 'after', phonetic: '', pos: 'conj', meaning: '之后', frequencyLevel: 5, frequencyLabel: '罕见' },
])
const meaningCards = cleanCardRecords([
  ...cards,
  { cardId: 'f', word: 'build', phonetic: '', pos: 'v', meaning: '建造', frequencyLevel: 1 },
  { cardId: 'g', word: 'carry', phonetic: '', pos: 'v', meaning: '携带', frequencyLevel: 1 },
  { cardId: 'h', word: 'decide', phonetic: '', pos: 'v', meaning: '决定', frequencyLevel: 1 },
  { cardId: 'i', word: 'explain', phonetic: '', pos: 'v', meaning: '解释', frequencyLevel: 1 },
])

const runtime = (card = cards[0], face: RuntimeCard['face'] = 'meaning'): RuntimeCard => ({ card, face, instanceId: `${card.cardId}-1` })

describe('card data and questions', () => {
  it('removes duplicate rows and obvious name noise', () => {
    expect(cards).toHaveLength(5)
    expect(cards[0].meaning).toBe('放弃')
    expect(cleanCardRecords([
      { cardId: 'name-only', word: 'able', pos: 'n', meaning: '(Able)人名；(伊朗)阿布勒；(英)埃布尔', frequencyLevel: 1 },
    ])).toHaveLength(0)
    expect(cleanCardRecords([
      { cardId: 'mixed', word: 'youth', pos: 'n', meaning: '青年；(Youth)《芳华》（电影名）', frequencyLevel: 1 },
    ])[0].meaning).toBe('青年')
    expect(cleanCardRecords([
      { cardId: 'person-appendix', word: 'pope', pos: 'n', meaning: '蒲伯（英国诗人）；罗马教皇', frequencyLevel: 1 },
      { cardId: 'standalone-name', word: 'temple', pos: 'n', meaning: '庙宇；（Temple）', frequencyLevel: 1 },
    ].map((item) => ({ ...item, phonetic: '' }))).map((item) => item.meaning)).toEqual(['罗马教皇', '庙宇'])
    expect(cleanCardRecords([
      { cardId: 'spaced-name', word: 'toward', pos: 'n', meaning: '(Toward) （美、加、沙特）特沃德', frequencyLevel: 1 },
    ])).toHaveLength(0)
  })
  it('builds five distinct meaning choices without same-word distractors', () => {
    const question = buildMeaningQuestion(runtime(), meaningCards, () => 0.2)
    expect(question.type).toBe('meaning')
    if (question.type === 'meaning') {
      expect(question.options).toHaveLength(5)
      expect(new Set(question.options.map((item) => item.meaning)).size).toBe(5)
      expect(question.options.filter((item) => item.word === 'abandon')).toHaveLength(1)
      expect(question.options.every((item) => item.pos === 'v')).toBe(true)
    }
  })
  it('grades spelling case-insensitively but otherwise strictly', () => {
    expect(isSpellingCorrect(' ABANDON ', 'abandon')).toBe(true)
    expect(isSpellingCorrect('abandun', 'abandon')).toBe(false)
  })
})

describe('battle rules', () => {
  it('draws without repeating words when possible', () => {
    const result = drawCards(cards, {}, 5, () => 0.1)
    expect(new Set(result.map((item) => item.word)).size).toBe(5)
  })
  it('keeps at least one spelling card in a multi-card hand', () => {
    const hand = makeRuntimeCards(cards, () => 0.1)
    expect(hand.some((card) => card.face === 'spelling')).toBe(true)
  })
  it('resolves a correct attack and a direct wrong-answer hit', () => {
    const battle = createBattle([], [])
    const attacked = applyCardEffect(battle, runtime()).state
    expect(attacked.enemy.hp).toBe(35)
    attacked.player.hp -= 2
    expect(attacked.player.hp).toBe(28)
  })
  it('creates custom enemies with shields and applies registered abilities', () => {
    const enemy: EnemyDefinition = { id: 'warden', name: 'WARDEN', subtitle: '守卫', icon: 'shield', maxHp: 18, attack: 3, shield: 4, abilities: [{ type: 'fixed-shield-per-turn', amount: 2, description: '每回合获得 2 点护盾' }] }
    const battle = createBattle([], [], 'practice', enemy)
    expect(battle.enemy).toMatchObject({ id: 'warden', hp: 18, shield: 0, name: 'WARDEN' })
    const next = finishEnemyTurn(battle)
    expect(next.enemy.shield).toBe(2)
    expect(enemyAttack(next)).toBe(3)
  })
  it('creates a configured character with passives', () => {
    const character: CharacterDefinition = {
      id: 'test-character', name: 'TEST', subtitle: '测试角色', icon: 'shield', maxHp: 20, shield: 1,
      abilities: [
        { id: 'hp', kind: 'passive', type: 'passive-max-hp', amount: 5, description: '最大生命增加 5 点' },
        { id: 'shield', kind: 'passive', type: 'passive-start-shield', amount: 3, description: '开局获得 3 点护盾' },
        { id: 'heal', kind: 'passive', type: 'passive-heal-per-turn', amount: 2, description: '每回合回复 2 点生命' },
      ],
    }
    const battle = createBattle([], [], 'practice', undefined, character)
    expect(battle.player).toMatchObject({ maxHp: 25, hp: 25, shield: 4 })
    battle.player.hp = 20
    expect(finishEnemyTurn(battle).player.hp).toBe(22)
  })
  it('uses active character skills without action energy and applies cooldowns', () => {
    const character: CharacterDefinition = {
      id: 'test-character', name: 'TEST', subtitle: '测试角色', icon: 'flame', maxHp: 20, abilities: [
        { id: 'burst', kind: 'active', type: 'active-damage', amount: 6, cooldown: 2, description: '造成 6 点伤害' },
      ],
    }
    const battle = createBattle([], [], 'practice', undefined, character)
    battle.player.energy = 1
    battle.enemy.shield = 2
    const { state } = useCharacterAbility(battle, 'burst')!
    expect(state.player.energy).toBe(1)
    expect(state.enemy).toMatchObject({ hp: 36, shield: 0 })
    expect(state.character.cooldowns.burst).toBe(2)
    expect(useCharacterAbility(state, 'burst')).toBeNull()
    const afterOneTurn = finishEnemyTurn(state)
    expect(afterOneTurn.character.cooldowns.burst).toBe(1)
    expect(useCharacterAbility(afterOneTurn, 'burst')).toBeNull()
    expect(useCharacterAbility(finishEnemyTurn(afterOneTurn), 'burst')).not.toBeNull()
  })
  it('increases shield and healing values for easier recovery', () => {
    const shieldCard = runtime(cards[1])
    const shielded = applyCardEffect(createBattle([], []), shieldCard).state
    expect(shielded.player.shield).toBe(6)

    const healingCard = runtime(cards[4])
    const wounded = createBattle([], [])
    wounded.player.hp = 20
    const healed = applyCardEffect(wounded, healingCard).state
    expect(healed.player.hp).toBe(25)
  })
  it('uses shield before health and scales the enemy every three turns', () => {
    const battle = createBattle([], [])
    battle.player.shield = 5
    const first = finishEnemyTurn(battle)
    expect(first.player.hp).toBe(30)
    expect(first.player.shield).toBe(0)
    const third = finishEnemyTurn(finishEnemyTurn(first))
    expect(third.enemy.turns).toBe(3)
    expect(third.player.hp).toBe(21)
  })

  it('moves through a campaign and wins at the end of a defeat-all queue', () => {
    const first: EnemyDefinition = { id: 'first', name: 'FIRST', subtitle: '一', icon: 'eye', maxHp: 1, attack: 0, shield: 0, abilities: [] }
    const second: EnemyDefinition = { id: 'second', name: 'SECOND', subtitle: '二', icon: 'crown', maxHp: 1, attack: 0, shield: 0, abilities: [], isFinal: true }
    const battle = createBattle([], [], 'practice', first)
    battle.campaignGoal = 'defeat-all'
    battle.campaignEnemyQueue = [first, second]
    battle.campaignEnemyIndex = 0
    battle.enemy.hp = 0
    const next = advanceCampaignEnemy(battle)
    expect(next?.enemy.id).toBe('second')
    expect(next?.campaignEnemyIndex).toBe(1)
    next!.enemy.hp = 0
    expect(advanceCampaignEnemy(next!)).toBeNull()
  })

  it('loops a learning campaign until every target card is correct', () => {
    const first: EnemyDefinition = { id: 'first', name: 'FIRST', subtitle: '一', icon: 'eye', maxHp: 1, attack: 0, shield: 0, abilities: [] }
    const battle = createBattle([], [], 'practice', first)
    battle.campaignGoal = 'learn-all'
    battle.campaignEnemyQueue = [first]
    battle.campaignEnemyIndex = 0
    battle.learningRemainingCardIds = ['a']
    battle.enemy.hp = 0
    expect(advanceCampaignEnemy(battle)?.campaignEnemyIndex).toBe(0)
    battle.learningRemainingCardIds = []
    expect(advanceCampaignEnemy(battle)).toBeNull()
  })

  it('keeps missed learning cards queued and removes correct cards from the run', () => {
    const battle = createBattle([cards[1]], [runtime(cards[0])], 'learning')
    battle.learningDeckId = 'standard-001'
    battle.learningRemainingCardIds = ['a', 'b']
    battle.learningPendingCounts = { a: 1, b: 1 }

    const retried = returnLearningCardToQueue(battle, runtime(cards[0]))
    expect(retried.drawPile.map((card) => card.cardId)).toEqual(['b', 'a'])
    expect(retried.learningRemainingCardIds).toEqual(['a', 'b'])
    expect(retried.learningPendingCounts?.a).toBe(2)

    const firstCorrect = markLearningCardCorrect(retried, runtime(cards[0]))
    expect(firstCorrect.learningRemainingCardIds).toEqual(['a', 'b'])
    expect(firstCorrect.drawPile.map((card) => card.cardId)).toEqual(['b', 'a'])
    const mastered = markLearningCardCorrect(firstCorrect, runtime(cards[0]))
    expect(mastered.learningRemainingCardIds).toEqual(['b'])
    expect(canCompleteLearningDeck(mastered)).toBe(false)
    expect(canCompleteLearningDeck(markLearningCardCorrect(mastered, 'b'))).toBe(true)
  })

  it('converts excess player shield into enemy damage after enemy shield', () => {
    const battle = createBattle([], [])
    battle.player.shield = 8
    battle.enemy.shield = 2
    const result = addPlayerShield(battle, 5)
    expect(result).toMatchObject({ gained: 2, overflow: 3, blocked: 2, damage: 1 })
    expect(battle.player.shield).toBe(10)
    expect(battle.enemy.shield).toBe(0)
    expect(battle.enemy.hp).toBe(39)
  })

  it('protects a learning battle from premature enemy defeat', () => {
    const battle = createBattle([], [], 'learning')
    battle.learningDeckId = 'standard-001'
    battle.learningRemainingCardIds = ['a']
    battle.enemy.hp = 0
    expect(protectLearningBattle(battle).enemy.hp).toBe(1)

    battle.learningRemainingCardIds = []
    expect(protectLearningBattle(battle).enemy.hp).toBe(0)
  })

  it('keeps drawing after a full hand and damages the player for overflow', () => {
    const battle = createBattle([], Array.from({ length: 8 }, (_, index) => runtime(cards[index % cards.length], 'meaning')))
    const result = drawTurnCards(battle, [cards[0], cards[1], cards[2]])
    expect(result.overflow).toBe(3)
    expect(result.state.hand).toHaveLength(8)
    expect(result.state.discardCount).toBe(3)
    expect(result.state.player.hp).toBe(27)
  })

  it('turns overflow damage into defeat when the last health is lost', () => {
    const battle = createBattle([], Array.from({ length: 8 }, (_, index) => runtime(cards[index % cards.length], 'meaning')))
    battle.player.hp = 1
    const result = drawTurnCards(battle, [cards[0], cards[1]])
    expect(result.state.status).toBe('defeat')
    expect(result.state.player.hp).toBe(0)
  })
})
