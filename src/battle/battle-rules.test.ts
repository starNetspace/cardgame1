import { describe, expect, it } from 'vitest'
import { cleanCardRecords, drawCards, makeRuntimeCards } from '../library/card-library'
import { buildMeaningQuestion, isSpellingCorrect } from './question-engine'
import { addPlayerShield, advanceCampaignEnemy, applyCardEffect, canCompleteLearningDeck, createBattle, dealDamageToEnemy, drawTurnCards, effectDescription, enemyAttack, finishEnemyTurn, markLearningCardCorrect, protectLearningBattle, returnLearningCardToQueue, TURN_ENERGY, useCharacterAbility } from './battle-rules'
import type { CharacterDefinition, EnemyDefinition, RuntimeCard } from '../shared/domain-types'

const rawCards = [
  { cardId: 'a', word: 'abandon', phonetic: '', pos: 'v', meaning: '放弃；(Abandon)人名', frequencyLevel: 2, frequencyLabel: '较高频' },
  { cardId: 'b', word: 'ability', phonetic: '', pos: 'n', meaning: '能力', frequencyLevel: 3, frequencyLabel: '中频' },
  { cardId: 'c', word: 'able', phonetic: '', pos: 'adj', meaning: '有能力的', frequencyLevel: 1, frequencyLabel: '高频' },
  { cardId: 'd', word: 'abroad', phonetic: '', pos: 'adv', meaning: '在国外', frequencyLevel: 4, frequencyLabel: '低频' },
  { cardId: 'e', word: 'after', phonetic: '', pos: 'conj', meaning: '之后', frequencyLevel: 5, frequencyLabel: '罕见' },
]
const allCards = cleanCardRecords(rawCards)
const cards = allCards.filter((card) => card.face === 'meaning')
const spellingCards = allCards.filter((card) => card.face === 'spelling')
const meaningCards = cleanCardRecords([
  ...rawCards,
  { cardId: 'f', word: 'build', phonetic: '', pos: 'v', meaning: '建造', frequencyLevel: 1 },
  { cardId: 'g', word: 'carry', phonetic: '', pos: 'v', meaning: '携带', frequencyLevel: 1 },
  { cardId: 'h', word: 'decide', phonetic: '', pos: 'v', meaning: '决定', frequencyLevel: 1 },
  { cardId: 'i', word: 'explain', phonetic: '', pos: 'v', meaning: '解释', frequencyLevel: 1 },
]).filter((card) => card.face === 'meaning')

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
    ].map((item) => ({ ...item, phonetic: '' }))).filter((item) => item.face === 'meaning').map((item) => item.meaning)).toEqual(['罗马教皇', '庙宇'])
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
  it('produces both meaning and spelling runtime cards from the split deck', () => {
    const hand = makeRuntimeCards(allCards)
    expect(hand.some((card) => card.face === 'spelling')).toBe(true)
    expect(hand.some((card) => card.face === 'meaning')).toBe(true)
  })
  it('resolves a correct attack and a direct wrong-answer hit', () => {
    const battle = createBattle([], [])
    const attacked = applyCardEffect(battle, runtime()).state
    expect(attacked.enemy.hp).toBe(36)
    attacked.player.hp -= 2
    expect(attacked.player.hp).toBe(28)
  })

  it('adds a 25% rounded-up bonus to spelling card effects', () => {
    const battle = createBattle([], [])
    expect(applyCardEffect(battle, runtime(cards[0], 'spelling')).state.enemy.hp).toBe(35)
    expect(applyCardEffect(battle, runtime(cards[1], 'spelling')).state.player.shield).toBe(8)

    const boosted = applyCardEffect(battle, runtime(cards[2], 'spelling')).state
    expect(boosted.boost).toBe(4)
    expect(applyCardEffect(boosted, runtime(cards[0])).state.enemy.hp).toBe(32)

    const drawBattle = createBattle([...cards], [])
    expect(applyCardEffect(drawBattle, runtime(cards[3], 'spelling')).state.hand).toHaveLength(4)

    const healBattle = createBattle([], [])
    healBattle.player.hp = 10
    expect(applyCardEffect(healBattle, runtime(cards[4], 'spelling')).state.player.hp).toBe(23)

    expect(effectDescription(runtime(cards[0]))).toBe('造成 4 点伤害')
    expect(effectDescription(runtime(cards[0], 'spelling'))).toBe('造成 5 点伤害')
    expect(effectDescription(runtime(cards[1], 'spelling'))).toBe('获得 8 点护盾')
    expect(effectDescription(runtime(cards[2], 'spelling'))).toBe('下一张攻击或护盾 +4')
    expect(effectDescription(runtime(cards[3], 'spelling'))).toBe('额外抽 4 张牌')
    expect(effectDescription(runtime(cards[4], 'spelling'))).toBe('回复 13 点生命')
  })
  it('creates custom enemies with shields and applies registered abilities', () => {
    const enemy: EnemyDefinition = { id: 'warden', name: 'WARDEN', subtitle: '守卫', icon: 'shield', maxHp: 18, attack: 3, shield: 4, abilities: [{ type: 'fixed-shield-per-turn', amount: 2, description: '每回合获得 2 点护盾' }] }
    const battle = createBattle([], [], 'practice', enemy)
    expect(battle.enemy).toMatchObject({ id: 'warden', hp: 18, shield: 4, name: 'WARDEN' })
    const next = finishEnemyTurn(battle)
    expect(next.enemy.shield).toBe(6)
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
    expect(healed.player.hp).toBe(30)
  })

  it('uses level five card formulas and consumes a boost only once', () => {
    const attack = runtime({ ...cards[0], frequencyLevel: 5 })
    const shield = runtime({ ...cards[1], frequencyLevel: 5 })
    const boost = runtime({ ...cards[2], frequencyLevel: 5, effectType: 'boost' })
    const boosted = applyCardEffect(createBattle([], []), boost).state
    expect(boosted.boost).toBe(7)
    const afterAttack = applyCardEffect(boosted, attack).state
    expect(afterAttack.enemy.hp).toBe(26)
    expect(afterAttack.boost).toBe(0)
    const afterShield = applyCardEffect(afterAttack, shield).state
    expect(afterShield.player.shield).toBe(8)
    expect(afterShield.boost).toBe(0)
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
    battle.player.shield = 7
    const result = drawTurnCards(battle, [cards[0], cards[1], cards[2]])
    expect(result.overflow).toBe(3)
    expect(result.state.hand).toHaveLength(8)
    expect(result.state.discardCount).toBe(0)
    expect(result.state.drawPile).toEqual([cards[0], cards[1], cards[2]])
    expect(result.state.player.hp).toBe(20)
    expect(result.state.player.shield).toBe(7)
  })

  it('turns overflow damage into defeat when the last health is lost', () => {
    const battle = createBattle([], Array.from({ length: 8 }, (_, index) => runtime(cards[index % cards.length], 'meaning')))
    battle.player.hp = 1
    const result = drawTurnCards(battle, [cards[0], cards[1]])
    expect(result.state.status).toBe('defeat')
    expect(result.state.player.hp).toBe(0)
  })

  it('supports all seven character ability templates', () => {
    const character: CharacterDefinition = {
      id: 'all-templates', name: 'ALL TEMPLATES', subtitle: '模板测试', icon: 'shield', maxHp: 20, shield: 1,
      abilities: [
        { id: 'start-shield', kind: 'passive', type: 'passive-start-shield', amount: 2, description: '开局护盾 +2' },
        { id: 'max-hp', kind: 'passive', type: 'passive-max-hp', amount: 5, description: '最大生命 +5' },
        { id: 'turn-heal', kind: 'passive', type: 'passive-heal-per-turn', amount: 2, description: '每回合回复 2' },
        { id: 'card-bonus', kind: 'passive', type: 'passive-card-bonus', amount: 1, description: '攻防牌 +1' },
        { id: 'heal', kind: 'active', type: 'active-heal', amount: 4, cooldown: 2, description: '回复 4' },
        { id: 'shield', kind: 'active', type: 'active-shield', amount: 4, cooldown: 2, description: '护盾 4' },
        { id: 'damage', kind: 'active', type: 'active-damage', amount: 4, cooldown: 2, description: '伤害 4' },
      ],
    }
    const battle = createBattle([], [], 'practice', undefined, character)
    expect(battle.player).toMatchObject({ maxHp: 25, hp: 25, shield: 3 })

    battle.player.hp = 20
    expect(useCharacterAbility(battle, 'heal')?.state.player.hp).toBe(24)
    expect(useCharacterAbility(battle, 'shield')?.state.player.shield).toBe(7)
    expect(useCharacterAbility(battle, 'damage')?.state.enemy.hp).toBe(36)
    const cardResult = applyCardEffect(battle, runtime(cards[0])).state
    expect(cardResult.enemy.hp).toBe(35)
    expect(finishEnemyTurn(battle).player.hp).toBe(21)
  })

  it('supports all seven enemy ability templates', () => {
    const enemy: EnemyDefinition = {
      id: 'all-enemy-templates', name: 'ALL ENEMY TEMPLATES', subtitle: '敌方模板测试', icon: 'skull', maxHp: 30, attack: 4, shield: 1,
      abilities: [
        { type: 'fixed-shield-per-turn', amount: 2, description: '每回合护盾 +2' },
        { type: 'attack-scaling', amount: 1, everyTurns: 2, description: '每两回合攻击 +1' },
        { type: 'start-shield', amount: 3, description: '开局护盾 +3' },
        { type: 'heal-per-turn', amount: 2, description: '每回合回复 2' },
        { type: 'enrage', amount: 3, threshold: 0.5, description: '低血量攻击 +3' },
        { type: 'direct-damage-per-turn', amount: 1, description: '每回合额外伤害 1' },
        { type: 'shield-breaker', amount: 2, description: '穿透 2' },
      ],
    }
    const battle = createBattle([], [], 'practice', enemy)
    expect(battle.enemy.shield).toBe(4)
    battle.enemy.hp = 10
    battle.player.shield = 5
    const first = finishEnemyTurn(battle)
    expect(first.enemy).toMatchObject({ shield: 6, hp: 12, turns: 1 })
    expect(first.player).toMatchObject({ shield: 0, hp: 25 })
    const second = finishEnemyTurn(first)
    expect(enemyAttack(second)).toBe(8)
  })

  it('supports the optimized character ability effects', () => {
    const ema: CharacterDefinition = { id: 'ema', name: 'EMA', subtitle: '艾玛', maxHp: 24, shield: 0, abilities: [{ id: 'clear', kind: 'active', type: 'active-clear-shield-convert', amount: 1, cooldown: 3, description: '清盾并转攻击' }] }
    const emaBattle = createBattle([], [], 'practice', undefined, ema)
    emaBattle.enemy.shield = 6
    const emaNext = useCharacterAbility(emaBattle, 'clear')!.state
    expect(emaNext.enemy.shield).toBe(0)
    expect(emaNext.player.cardsAsAttackUntilEndTurn).toBe(true)
    // cards[1] 是 L3 名词护盾牌：原本数值 3+3=6，被转换为攻击后敌人 40-6=34
    expect(applyCardEffect(emaNext, runtime(cards[1])).state.enemy.hp).toBe(34)
    // cards[2] 是 L1 形容词强化牌：原本数值 2+1=3，被转换为攻击后敌人 40-3=37
    expect(applyCardEffect(emaNext, runtime(cards[2])).state.enemy.hp).toBe(37)

    const anan: CharacterDefinition = { id: 'anan', name: 'ANAN', subtitle: '安安', maxHp: 24, shield: 0, abilities: [{ id: 'immune', kind: 'active', type: 'active-immunity-reflect', amount: 1, cooldown: 3, description: '免疫反伤' }] }
    const ananBattle = createBattle([], [], 'practice', undefined, anan)
    const ananNext = finishEnemyTurn(useCharacterAbility(ananBattle, 'immune')!.state)
    expect(ananNext.player.hp).toBe(24)
    expect(ananNext.enemy.hp).toBe(36)

    const meruru: CharacterDefinition = { id: 'meruru', name: 'MERURU', subtitle: '梅露露', maxHp: 30, shield: 0, abilities: [{ id: 'syphon', kind: 'active', type: 'active-heal-current-hp-damage', amount: 5, cooldown: 5, description: '回复并造成当前生命伤害' }] }
    const meruruBattle = createBattle([], [], 'practice', undefined, meruru)
    meruruBattle.player.hp = 20
    const meruruNext = useCharacterAbility(meruruBattle, 'syphon')!.state
    expect(meruruNext.player.hp).toBe(25)
    expect(meruruNext.enemy.hp).toBe(15)

    const nanoka: CharacterDefinition = { id: 'nanoka', name: 'NANOKA', subtitle: '奈叶香', maxHp: 27, shield: 0, abilities: [{ id: 'echo', kind: 'active', type: 'active-repeat-last-turn-damage', amount: 0, cooldown: 3, description: '重复伤害' }] }
    const nanokaBattle = createBattle([], [], 'practice', undefined, nanoka)
    nanokaBattle.lastTurnDamageDealt = 12
    expect(useCharacterAbility(nanokaBattle, 'echo')!.state.enemy.hp).toBe(28)

    const margo: CharacterDefinition = { id: 'margo', name: 'MARGO', subtitle: '玛格', maxHp: 26, shield: 0, abilities: [{ id: 'double', kind: 'active', type: 'active-double-next-card', amount: 2, cooldown: 3, description: '下一张翻倍' }] }
    const margoBattle = createBattle([], [], 'practice', undefined, margo)
    const margoNext = applyCardEffect(useCharacterAbility(margoBattle, 'double')!.state, runtime(cards[0])).state
    expect(margoNext.enemy.hp).toBe(32)

    const miria: CharacterDefinition = { id: 'miria', name: 'MIRIA', subtitle: '米莉亚', maxHp: 30, shield: 0, abilities: [{ id: 'swap', kind: 'active', type: 'active-swap-health-shield', amount: 0, cooldown: 3, description: '交换' }] }
    const miriaBattle = createBattle([], [], 'practice', undefined, miria)
    miriaBattle.player.hp = 20
    miriaBattle.player.shield = 7
    miriaBattle.enemy.hp = 40
    miriaBattle.enemy.shield = 2
    const miriaNext = useCharacterAbility(miriaBattle, 'swap')!.state
    expect(miriaNext.player).toMatchObject({ hp: 30, shield: 2 })
    expect(miriaNext.enemy).toMatchObject({ hp: 20, shield: 7 })

    const alisa: CharacterDefinition = { id: 'alisa', name: 'ALISA', subtitle: '亚里沙', maxHp: 26, shield: 0, abilities: [{ id: 'surge', kind: 'active', type: 'active-turn-card-bonus', amount: 2, cooldown: 3, description: '本回合加值' }] }
    const alisaBattle = createBattle([], [], 'practice', undefined, alisa)
    expect(applyCardEffect(useCharacterAbility(alisaBattle, 'surge')!.state, runtime(cards[0])).state.enemy.hp).toBe(34)

    const coco: CharacterDefinition = { id: 'coco', name: 'COCO', subtitle: '可可', maxHp: 26, shield: 0, abilities: [{ id: 'tempo', kind: 'active', type: 'active-gain-energy', amount: 2, cooldown: 3, description: '行动力恢复' }] }
    const cocoBattle = createBattle([], [], 'practice', undefined, coco)
    cocoBattle.player.energy = 0
    cocoBattle.lastTurnCorrectEffectiveCards = 2
    expect(useCharacterAbility(cocoBattle, 'tempo')!.state.player.energy).toBe(2)

    const hanna: CharacterDefinition = { id: 'hanna', name: 'HANNA', subtitle: '汉娜', maxHp: 34, shield: 2, abilities: [{ id: 'ward', kind: 'passive', type: 'passive-shield-per-turn', amount: 2, description: '每回合护盾' }] }
    const hannaBattle = createBattle([], [], 'practice', undefined, hanna)
    hannaBattle.player.shield = 0
    expect(finishEnemyTurn(hannaBattle).player.shield).toBe(2)
  })

  it('supports enemy shield-ignore, revive-once, and instant-kill', () => {
    const shieldIgnoreEnemy: EnemyDefinition = { id: 'hanoka', name: 'HANOKA', subtitle: '穗乃香', maxHp: 40, attack: 4, shield: 0, abilities: [{ type: 'shield-ignore', amount: 1, cooldown: 2, description: '无视护盾' }] }
    const shieldIgnoreBattle = createBattle([], [], 'practice', shieldIgnoreEnemy)
    shieldIgnoreBattle.player.shield = 10
    const ignored = finishEnemyTurn(shieldIgnoreBattle)
    expect(ignored.player.hp).toBe(26)
    expect(ignored.enemy.abilityCooldowns?.['shield-ignore']).toBe(2)

    const reviveEnemy: EnemyDefinition = { id: 'hiro', name: 'HIRO', subtitle: '二阶堂', maxHp: 30, attack: 4, shield: 0, abilities: [{ type: 'revive-once', amount: 50, cooldown: 10, description: '复活' }] }
    const reviveBattle = createBattle([], [], 'practice', reviveEnemy)
    dealDamageToEnemy(reviveBattle, 30)
    expect(reviveBattle.enemy.hp).toBe(15)
    expect(reviveBattle.enemy.reviveUsed).toBe(true)
    dealDamageToEnemy(reviveBattle, 15)
    expect(reviveBattle.enemy.hp).toBe(0)
    // 复活冷却 10 回合：复活后 10 个敌方回合内再次被击杀不会复活，
    // 但 10 回合后若仍未被击败，可再次触发复活。
    const cooldownBattle = createBattle([], [], 'practice', reviveEnemy)
    dealDamageToEnemy(cooldownBattle, 30)
    expect(cooldownBattle.enemy.hp).toBe(15)
    expect(cooldownBattle.enemy.abilityCooldowns?.['revive-once']).toBe(10)
    dealDamageToEnemy(cooldownBattle, 15)
    expect(cooldownBattle.enemy.hp).toBe(0)
    cooldownBattle.enemy.hp = 30
    let afterTurns = cooldownBattle
    for (let turn = 0; turn < 10; turn += 1) afterTurns = finishEnemyTurn(afterTurns)
    expect(afterTurns.enemy.abilityCooldowns?.['revive-once']).toBe(0)
    dealDamageToEnemy(afterTurns, 30)
    expect(afterTurns.enemy.hp).toBe(15)
    expect(afterTurns.enemy.reviveUsed).toBe(true)

    const instantKillEnemy: EnemyDefinition = { id: 'yuki', name: 'YUKI', subtitle: '雪', maxHp: 30, attack: 4, shield: 0, abilities: [{ type: 'instant-kill-at-turn', amount: 0, turnLimit: 2, description: '第 2 回合击杀' }] }
    const instantKillBattle = createBattle([], [], 'practice', instantKillEnemy)
    expect(finishEnemyTurn(instantKillBattle).status).toBe('playing')
    const killed = finishEnemyTurn(finishEnemyTurn(instantKillBattle))
    expect(killed.status).toBe('defeat')
    expect(killed.player.hp).toBe(0)
  })
  it('returns draw-card overflow back to the draw pile', () => {
    const battle = createBattle([cards[0], cards[1], cards[2]], Array.from({ length: 7 }, (_, index) => runtime(cards[index % cards.length], 'meaning')))
    const result = applyCardEffect(battle, runtime(cards[3]))
    expect(result.state.hand).toHaveLength(8)
    expect(result.state.drawPile.map((card) => card.cardId)).toEqual(['b', 'c'])
  })
  it('applies the full-hand penalty even when the draw pile is empty', () => {
    const battle = createBattle([], Array.from({ length: 8 }, (_, index) => runtime(cards[index % cards.length], 'meaning')))
    const result = drawTurnCards(battle, [])
    expect(result.overflow).toBe(0)
    expect(result.state.player.hp).toBe(20)
    expect(result.state.drawPile).toHaveLength(0)
  })
})




