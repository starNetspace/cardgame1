import type { BattleMode, BattleState, CardRecord, CharacterAbility, CharacterDefinition, CharacterState, EnemyDefinition, EffectType, RuntimeCard } from '../shared/domain-types'
import { makeRuntimeCards } from '../library/card-library'

export const MAX_HAND = 8
export const MAX_SHIELD = 10
export const TURN_DRAW = 5
export const TURN_ENERGY = 3
export const WRONG_DAMAGE = 2
export const FULL_HAND_DAMAGE = 2
export const SPELLING_BONUS_MULTIPLIER = 1.25

const DEFAULT_ENEMY: EnemyDefinition = {
  id: 'default-forgetter', name: 'THE FORGETTER', subtitle: '遗忘者', icon: 'skull', maxHp: 40, attack: 4,
  shield: 0, abilities: [{ type: 'attack-scaling', amount: 1, everyTurns: 3, description: '每三回合攻击力增加 1' }],
}

export const DEFAULT_CHARACTER: CharacterDefinition = {
  id: 'memory-sentinel', name: 'MEMORY SENTINEL', subtitle: '记忆守卫', icon: 'shield', maxHp: 30, shield: 0,
  // Legacy battles without a selected character retain the original 30 HP / 0 shield rules.
  abilities: [],
}

export function effectLabel(type: EffectType): string {
  return { attack: '攻击', shield: '护盾', boost: '强化', draw: '抽牌', heal: '回复' }[type]
}

function spellingBonus(face: RuntimeCard['face'], value: number): number {
  return face === 'spelling' ? Math.ceil(value * SPELLING_BONUS_MULTIPLIER) : value
}

/** The card's own effect value by its original type, used when Ema converts cards into attacks. */
function effectBaseValue(card: CardRecord): number {
  switch (card.effectType) {
    case 'attack': return 2 + card.frequencyLevel
    case 'shield': return 3 + card.frequencyLevel
    case 'boost': return 2 + card.frequencyLevel
    case 'draw': return 1 + Math.floor(card.frequencyLevel / 2)
    case 'heal': return 5 + card.frequencyLevel
  }
}

export function effectDescription(card: RuntimeCard): string {
  const level = card.card.frequencyLevel
  switch (card.card.effectType) {
    case 'attack': return `造成 ${spellingBonus(card.face, 2 + level)} 点伤害`
    case 'shield': return `获得 ${spellingBonus(card.face, 3 + level)} 点护盾`
    case 'boost': return `下一张攻击或护盾 +${spellingBonus(card.face, 2 + level)}`
    case 'draw': return `额外抽 ${spellingBonus(card.face, 1 + Math.floor(level / 2))} 张牌`
    case 'heal': return `回复 ${spellingBonus(card.face, 5 + level)} 点生命`
  }
}

export function enemyAttack(state: BattleState): number {
  const scaling = state.enemy.abilities
    .filter((ability) => ability.type === 'attack-scaling' && (ability.everyTurns ?? 0) > 0)
    .reduce((sum, ability) => sum + Math.floor(state.enemy.turns / (ability.everyTurns as number)) * ability.amount, 0)
  const enrage = state.enemy.abilities
    .filter((ability) => ability.type === 'enrage' && state.enemy.hp / state.enemy.maxHp <= (ability.threshold ?? 0.5))
    .reduce((sum, ability) => sum + ability.amount, 0)
  return state.enemy.attack + scaling + enrage
}

function enemyState(definition: EnemyDefinition) {
  const startShield = (definition.shield ?? 0) + definition.abilities
    .filter((ability) => ability.type === 'start-shield')
    .reduce((sum, ability) => sum + ability.amount, 0)
  return { ...definition, hp: definition.maxHp, shield: Math.min(MAX_SHIELD, startShield), turns: 0, abilityCooldowns: {}, reviveUsed: false }
}

export function characterMaxHp(definition: CharacterDefinition): number {
  return definition.maxHp + definition.abilities.filter((ability) => ability.type === 'passive-max-hp').reduce((sum, ability) => sum + ability.amount, 0)
}

export function characterStartShield(definition: CharacterDefinition): number {
  return Math.min(MAX_SHIELD, (definition.shield ?? 0) + definition.abilities.filter((ability) => ability.type === 'passive-start-shield').reduce((sum, ability) => sum + ability.amount, 0))
}

function characterState(definition: CharacterDefinition): CharacterState {
  return { ...definition, cooldowns: {} }
}

export function createBattle(drawPile: import('../shared/domain-types').CardRecord[], hand: RuntimeCard[], mode: BattleMode = 'practice', definition: EnemyDefinition = DEFAULT_ENEMY, character: CharacterDefinition = DEFAULT_CHARACTER): BattleState {
  const playerCharacter = characterState(character)
  return {
    mode,
    character: playerCharacter,
    player: { maxHp: characterMaxHp(character), hp: characterMaxHp(character), shield: characterStartShield(character), energy: TURN_ENERGY, immuneThisTurn: false, reflectThisTurn: false, nextCardDoubled: false, turnCardBonus: 0, cardsAsAttackUntilEndTurn: false },
    enemy: enemyState(definition),
    hand,
    drawPile,
    discardCount: 0,
    turn: 1,
    boost: 0,
    status: 'playing',
    usedCards: 0,
    correctAnswers: 0,
    totalAnswers: 0,
    faceStats: { meaning: { correct: 0, total: 0 }, spelling: { correct: 0, total: 0 } },
    errorCardIds: [],
    log: ['战斗开始。选择一张手牌完成答题。'],
    turnDamageDealt: 0,
    lastTurnDamageDealt: 0,
    turnCorrectEffectiveCards: 0,
    lastTurnCorrectEffectiveCards: 0,
  }
}

export function activeCharacterAbilities(state: BattleState): CharacterAbility[] {
  return state.character.abilities.filter((ability) => ability.kind === 'active')
}

export function canUseCharacterAbility(state: BattleState, abilityId: string): boolean {
  const ability = activeCharacterAbilities(state).find((item) => item.id === abilityId)
  return Boolean(ability && (state.character.cooldowns[abilityId] ?? 0) === 0 && state.status === 'playing' && state.player.hp > 0)
}

export function useCharacterAbility(state: BattleState, abilityId: string): { state: BattleState; summary: string } | null {
  if (!canUseCharacterAbility(state, abilityId)) return null
  const next = structuredClone(state) as BattleState
  const ability = activeCharacterAbilities(next).find((item) => item.id === abilityId) as CharacterAbility
  next.character.cooldowns[ability.id] = ability.cooldown as number
  let summary = ability.description
  if (ability.type === 'active-heal') {
    const healed = Math.min(ability.amount, next.player.maxHp - next.player.hp)
    next.player.hp += healed
    summary = healed > 0 ? `角色技能：回复 ${healed} 点生命` : '角色技能：生命已满'
  } else if (ability.type === 'active-shield') {
    const result = addPlayerShield(next, ability.amount)
    summary = result.overflow > 0
      ? `角色技能：护盾达到上限，溢出 ${result.overflow} 点并对敌人造成 ${result.damage} 点伤害`
      : `角色技能：获得 ${result.gained} 点护盾`
  } else if (ability.type === 'active-damage') {
    const { blocked, damage } = dealDamageToEnemy(next, ability.amount)
    summary = blocked > 0 ? `角色技能：造成 ${damage} 点伤害，击破 ${blocked} 点护盾` : `角色技能：造成 ${damage} 点伤害`
  } else if (ability.type === 'active-clear-shield-convert') {
    next.enemy.shield = 0
    next.player.cardsAsAttackUntilEndTurn = true
    summary = '角色技能：敌方护盾已清空，本回合所有手牌按原本数值结算为攻击'
  } else if (ability.type === 'active-immunity-reflect') {
    next.player.immuneThisTurn = true
    next.player.reflectThisTurn = true
    summary = '角色技能：本回合免疫敌方伤害，并将原伤害全额反弹'
  } else if (ability.type === 'active-heal-current-hp-damage') {
    const healed = Math.min(ability.amount, next.player.maxHp - next.player.hp)
    next.player.hp += healed
    const { blocked, damage } = dealDamageToEnemy(next, next.player.hp)
    summary = `角色技能：回复 ${healed} 点生命，并对敌人造成 ${damage} 点伤害${blocked > 0 ? `，击破 ${blocked} 点护盾` : ''}`
  } else if (ability.type === 'active-repeat-last-turn-damage') {
    const amount = next.lastTurnDamageDealt ?? 0
    if (amount <= 0) {
      summary = '角色技能：上一回合没有造成可重复的伤害'
    } else {
      const { blocked, damage } = dealDamageToEnemy(next, amount)
      summary = blocked > 0 ? `角色技能：重复造成 ${damage} 点伤害，击破 ${blocked} 点护盾` : `角色技能：重复造成 ${damage} 点伤害`
    }
  } else if (ability.type === 'active-double-next-card') {
    next.player.nextCardDoubled = true
    summary = '角色技能：下一张有效手牌效果翻倍'
  } else if (ability.type === 'active-swap-health-shield') {
    const playerHp = next.player.hp
    const playerShield = next.player.shield
    next.player.hp = Math.min(next.player.maxHp, next.enemy.hp)
    next.enemy.hp = Math.min(next.enemy.maxHp, playerHp)
    next.player.shield = Math.min(MAX_SHIELD, next.enemy.shield)
    next.enemy.shield = Math.min(MAX_SHIELD, playerShield)
    summary = '角色技能：双方当前生命与护盾已交换'
  } else if (ability.type === 'active-turn-card-bonus') {
    next.player.turnCardBonus = ability.amount
    summary = `角色技能：本回合攻击牌和护盾牌数值 +${ability.amount}`
  } else if (ability.type === 'active-gain-energy') {
    const gained = Math.min(ability.amount, next.lastTurnCorrectEffectiveCards ?? 0)
    next.player.energy = Math.min(TURN_ENERGY, next.player.energy + gained)
    summary = gained > 0 ? `角色技能：增加 ${gained} 点行动力` : '角色技能：上一回合没有可转化为行动力的有效答对牌'
  }
  next.log = [summary, ...next.log].slice(0, 8)
  return { state: next, summary }
}

export function applyCardEffect(state: BattleState, card: RuntimeCard): { state: BattleState; summary: string } {
  const next = structuredClone(state) as BattleState
  const level = card.card.frequencyLevel
  const passiveBonus = next.character.abilities.filter((ability) => ability.type === 'passive-card-bonus').reduce((sum, ability) => sum + ability.amount, 0)
  const turnBonus = next.player.turnCardBonus ?? 0
  const cardBonus = passiveBonus + turnBonus
  const bonus = next.boost
  const multiplier = next.player.nextCardDoubled ? 2 : 1
  if (next.player.nextCardDoubled) next.player.nextCardDoubled = false
  const effectType = next.player.cardsAsAttackUntilEndTurn ? 'attack' : card.card.effectType
  let summary = ''
  switch (effectType) {
    case 'attack': {
      const baseValue = next.player.cardsAsAttackUntilEndTurn ? effectBaseValue(card.card) : 2 + level
      const amount = spellingBonus(card.face, baseValue + bonus + cardBonus) * multiplier
      const { blocked, damage } = dealDamageToEnemy(next, amount)
      next.boost = 0
      summary = blocked > 0 ? `造成 ${damage} 点伤害，击破 ${blocked} 点护盾` : `对敌人造成 ${amount} 点伤害`
      break
    }
    case 'shield': {
      const amount = spellingBonus(card.face, 3 + level + bonus + cardBonus) * multiplier
      const result = addPlayerShield(next, amount)
      next.boost = 0
      summary = result.overflow > 0
        ? `护盾达到上限，溢出 ${result.overflow} 点并对敌人造成 ${result.damage} 点伤害`
        : `获得 ${result.gained} 点护盾`
      break
    }
    case 'boost':
      next.boost += spellingBonus(card.face, 2 + level) * multiplier
      summary = `下一张攻击或护盾牌强化 ${spellingBonus(card.face, 2 + level) * multiplier} 点`
      break
    case 'draw': {
      const amount = spellingBonus(card.face, 1 + Math.floor(level / 2)) * multiplier
      const needsSpelling = !next.hand.some((item) => item.face === 'spelling')
      const drawn = next.drawPile.slice(0, amount)
      const accepted = drawn.slice(0, Math.max(0, MAX_HAND - next.hand.length))
      const overflowCards = drawn.slice(accepted.length)
      next.hand = [...next.hand, ...makeRuntimeCards(accepted, Math.random, needsSpelling)]
      next.drawPile = [...next.drawPile.slice(Math.min(amount, next.drawPile.length)), ...overflowCards]
      summary = overflowCards.length > 0 ? `抽取 ${amount} 张牌，手牌已满，${overflowCards.length} 张放回牌库` : `抽取 ${amount} 张牌`
      break
    }
    case 'heal': {
      const amount = spellingBonus(card.face, 5 + level) * multiplier
      const healed = Math.min(amount, next.player.maxHp - next.player.hp)
      next.player.hp += healed
      summary = healed > 0 ? `回复 ${healed} 点生命` : '生命已满，未产生回复'
      break
    }
  }
  return { state: next, summary }
}

export function dealDamageToEnemy(state: BattleState, amount: number): { blocked: number; damage: number } {
  const blocked = Math.min(state.enemy.shield, Math.max(0, amount))
  const damage = Math.max(0, amount - blocked)
  state.turnDamageDealt = (state.turnDamageDealt ?? 0) + damage
  state.enemy.shield -= blocked
  const reviveAbility = state.enemy.abilities.find((ability) => ability.type === 'revive-once')
  const reviveCooldown = reviveAbility?.cooldown
  const reviveReady = !state.enemy.reviveUsed || ((reviveCooldown ?? 0) > 0 && (state.enemy.abilityCooldowns?.['revive-once'] ?? 0) === 0)
  if (damage > 0 && reviveReady && reviveAbility && state.enemy.hp - damage <= 0) {
    state.enemy.reviveUsed = true
    state.enemy.shield = 0
    state.enemy.hp = Math.max(1, Math.round(state.enemy.maxHp * Math.min(100, reviveAbility.amount) / 100))
    if (reviveCooldown !== undefined) state.enemy.abilityCooldowns = { ...(state.enemy.abilityCooldowns ?? {}), 'revive-once': reviveCooldown }
    state.log = [`${state.enemy.name} 触发一次复活，恢复至 ${state.enemy.hp} 点生命${reviveCooldown !== undefined ? `，${reviveCooldown} 回合后可再次复活` : ''}。`, ...state.log].slice(0, 8)
    return { blocked, damage }
  }
  state.enemy.hp = Math.max(0, state.enemy.hp - damage)
  return { blocked, damage }
}

export function addPlayerShield(state: BattleState, amount: number): { gained: number; overflow: number; blocked: number; damage: number } {
  const available = Math.max(0, MAX_SHIELD - state.player.shield)
  const gained = Math.min(Math.max(0, amount), available)
  const overflow = Math.max(0, amount - gained)
  state.player.shield += gained
  const { blocked, damage } = dealDamageToEnemy(state, overflow)
  return { gained, overflow, blocked, damage }
}

/** Turn draws are allowed to overflow the hand; each overflow card deals 2 true damage. */
export function drawTurnCards(state: BattleState, cards: import('../shared/domain-types').CardRecord[]): { state: BattleState; overflow: number } {
  const next = structuredClone(state) as BattleState
  const availableSlots = Math.max(0, MAX_HAND - next.hand.length)
  const accepted = cards.slice(0, availableSlots)
  const overflowCards = cards.slice(availableSlots)
  const overflow = overflowCards.length
  const needsSpelling = !next.hand.some((item) => item.face === 'spelling')
  next.hand = [...next.hand, ...makeRuntimeCards(accepted, Math.random, needsSpelling)]
  if (overflow > 0) {
    // Overflow cards return to the draw pile so they are never lost from a learning run.
    next.drawPile = [...next.drawPile, ...overflowCards]
  }
  // Ending a turn with a full hand always pays the full overflow penalty, even
  // when the draw pile is empty and no cards could be drawn.
  const penaltyCount = availableSlots === 0 ? Math.max(overflow, TURN_DRAW) : overflow
  if (penaltyCount > 0) {
    next.player.hp = Math.max(0, next.player.hp - penaltyCount * FULL_HAND_DAMAGE)
    next.log = overflow > 0
      ? [`手牌已满，${overflow} 张抽到的牌放回牌库，受到 ${penaltyCount * FULL_HAND_DAMAGE} 点真实伤害。`, ...next.log].slice(0, 8)
      : [`手牌已满，结束回合受到 ${penaltyCount * FULL_HAND_DAMAGE} 点真实伤害。`, ...next.log].slice(0, 8)
  }
  if (next.player.hp <= 0) next.status = 'defeat'
  return { state: next, overflow }
}

/** Learning battles keep missed cards in the selected deck's active queue. */
export function returnLearningCardToQueue(state: BattleState, card: RuntimeCard): BattleState {
  const next = structuredClone(state) as BattleState
  if (!next.learningDeckId && next.campaignGoal !== 'learn-all') return next
  if (next.learningDeckId) {
    const pending = next.learningPendingCounts ?? Object.fromEntries((next.learningRemainingCardIds ?? []).map((id) => [id, 1]))
    pending[card.card.cardId] = (pending[card.card.cardId] ?? 1) + 1
    next.learningPendingCounts = pending
    next.learningLastIncorrectAt = { ...(next.learningLastIncorrectAt ?? {}), [card.card.cardId]: Date.now() }
    next.learningRemainingCardIds = Object.keys(pending).filter((id) => pending[id] > 0)
  }
  next.drawPile = next.drawPile.some((item) => item.cardId === card.card.cardId)
    ? next.drawPile
    : [...next.drawPile, card.card]
  return next
}

/** A correct answer removes this card from the current learning run. */
export function markLearningCardCorrect(state: BattleState, card: RuntimeCard | string): BattleState {
  const next = structuredClone(state) as BattleState
  const cardId = typeof card === 'string' ? card : card.card.cardId
  if (next.learningDeckId) {
    const pending = next.learningPendingCounts ?? Object.fromEntries((next.learningRemainingCardIds ?? []).map((id) => [id, 1]))
    pending[cardId] = Math.max(0, (pending[cardId] ?? 1) - 1)
    next.learningPendingCounts = pending
    next.learningRemainingCardIds = Object.keys(pending).filter((id) => pending[id] > 0)
    const queuedCard = typeof card === 'string' ? next.drawPile.find((item) => item.cardId === cardId) : card.card
    next.drawPile = next.drawPile.filter((item) => item.cardId !== cardId)
    if (pending[cardId] > 0) {
      if (queuedCard) next.drawPile.push(queuedCard)
    }
    return next
  }
  if (next.learningRemainingCardIds) next.learningRemainingCardIds = next.learningRemainingCardIds.filter((id) => id !== cardId)
  next.drawPile = next.drawPile.filter((item) => item.cardId !== cardId)
  return next
}

export function canCompleteLearningDeck(state: BattleState): boolean {
  if (!state.learningDeckId && state.campaignGoal !== 'learn-all') return false
  if (state.learningDeckId && state.learningPendingCounts) return Object.values(state.learningPendingCounts).every((count) => count <= 0)
  return state.learningRemainingCardIds?.length === 0
}

/** A learning battle cannot end from damage until every card is answered. */
export function protectLearningBattle(state: BattleState): BattleState {
  const next = structuredClone(state) as BattleState
  if (next.learningDeckId && !next.campaignGoal && !canCompleteLearningDeck(next) && next.enemy.hp <= 0) next.enemy.hp = 1
  return next
}

export function hasCampaignNextEnemy(state: BattleState): boolean {
  return Boolean(state.campaignEnemyQueue?.length && state.campaignEnemyIndex !== undefined)
}

export function advanceCampaignEnemy(state: BattleState): BattleState | null {
  if (!hasCampaignNextEnemy(state)) return null
  const queue = state.campaignEnemyQueue as EnemyDefinition[]
  const currentIndex = state.campaignEnemyIndex as number
  const hasNext = currentIndex + 1 < queue.length
  const shouldLoop = state.campaignGoal === 'learn-all' && !canCompleteLearningDeck(state)
  if (!hasNext && !shouldLoop) return null
  const nextIndex = hasNext ? currentIndex + 1 : 0
  const next = structuredClone(state) as BattleState
  next.campaignEnemyIndex = nextIndex
  next.enemy = enemyState(queue[nextIndex])
  next.status = 'playing'
  next.log = [`击败 ${state.enemy.name}，${next.enemy.name} 进入战场。`, ...next.log].slice(0, 8)
  return next
}

export function campaignEnemyProgress(state: BattleState): { current: number; total: number } | null {
  if (!hasCampaignNextEnemy(state)) return null
  return { current: (state.campaignEnemyIndex as number) + 1, total: (state.campaignEnemyQueue as EnemyDefinition[]).length }
}

export function finishEnemyTurn(state: BattleState): BattleState {
  const next = structuredClone(state) as BattleState
  const enemyTurn = next.enemy.turns + 1
  next.enemy.turns = enemyTurn
  next.enemy.abilityCooldowns = Object.fromEntries(Object.entries(next.enemy.abilityCooldowns ?? {}).map(([id, cooldown]) => [id, Math.max(0, cooldown - 1)]))

  const instantKill = next.enemy.abilities.find((ability) => ability.type === 'instant-kill-at-turn')
  if (instantKill && enemyTurn >= (instantKill.turnLimit ?? 0)) {
    next.player.hp = 0
    next.status = 'defeat'
    next.log = [`${next.enemy.name} 触发即死效果，战斗失败。`, ...next.log].slice(0, 8)
    return next
  }

  const shieldGain = next.enemy.abilities.filter((ability) => ability.type === 'fixed-shield-per-turn').reduce((sum, ability) => sum + ability.amount, 0)
  next.enemy.shield = Math.min(MAX_SHIELD, next.enemy.shield + shieldGain)
  const healGain = next.enemy.abilities.filter((ability) => ability.type === 'heal-per-turn').reduce((sum, ability) => sum + ability.amount, 0)
  next.enemy.hp = Math.min(next.enemy.maxHp, next.enemy.hp + healGain)
  const incoming = enemyAttack(next)
  const directDamage = next.enemy.abilities.filter((ability) => ability.type === 'direct-damage-per-turn').reduce((sum, ability) => sum + ability.amount, 0)
  const shieldBreaker = next.player.shield > 0
    ? next.enemy.abilities.filter((ability) => ability.type === 'shield-breaker').reduce((sum, ability) => sum + ability.amount, 0)
    : 0
  const shieldIgnore = next.enemy.abilities.find((ability) => ability.type === 'shield-ignore')
  const ignoresShield = Boolean(shieldIgnore && (next.enemy.abilityCooldowns?.['shield-ignore'] ?? 0) === 0)
  let blocked = 0
  let damage = 0
  let shieldPiercing = 0
  if (next.player.immuneThisTurn) {
    blocked = incoming
    if (next.player.reflectThisTurn) dealDamageToEnemy(next, incoming)
  } else if (ignoresShield) {
    damage = incoming
    if (shieldIgnore) {
    if (shieldIgnore) next.enemy.abilityCooldowns = { ...(next.enemy.abilityCooldowns ?? {}), 'shield-ignore': shieldIgnore.cooldown ?? 0 }
    }
  } else {
    blocked = Math.min(next.player.shield, incoming)
    damage = incoming - blocked
    shieldPiercing = shieldBreaker
  }
  next.player.shield = 0
  next.player.hp = Math.max(0, next.player.hp - damage - directDamage - shieldPiercing)
  next.turn += 1
  next.player.energy = TURN_ENERGY
  next.boost = 0
  next.character.cooldowns = Object.fromEntries(Object.entries(next.character.cooldowns).map(([id, cooldown]) => [id, Math.max(0, cooldown - 1)]))
  next.lastTurnDamageDealt = next.turnDamageDealt ?? 0
  next.lastTurnCorrectEffectiveCards = next.turnCorrectEffectiveCards ?? 0
  next.turnDamageDealt = 0
  next.turnCorrectEffectiveCards = 0
  next.player.immuneThisTurn = false
  next.player.reflectThisTurn = false
  next.player.turnCardBonus = 0
  next.player.cardsAsAttackUntilEndTurn = false
  const passiveHeal = next.character.abilities.filter((ability) => ability.type === 'passive-heal-per-turn').reduce((sum, ability) => sum + ability.amount, 0)
  if (passiveHeal > 0 && next.player.hp > 0) next.player.hp = Math.min(next.player.maxHp, next.player.hp + passiveHeal)
  const passiveShield = next.character.abilities.filter((ability) => ability.type === 'passive-shield-per-turn').reduce((sum, ability) => sum + ability.amount, 0)
  if (passiveShield > 0 && next.player.hp > 0) next.player.shield = Math.min(MAX_SHIELD, passiveShield)
  next.log = [`${next.enemy.name} 攻击 ${incoming} 点，获得 ${shieldGain} 点护盾，恢复 ${healGain} 点生命，额外造成 ${directDamage + shieldPiercing} 点伤害，己方护盾抵挡 ${blocked} 点，受到 ${damage + directDamage + shieldPiercing} 点伤害。`, ...next.log].slice(0, 8)
  if (next.player.hp <= 0) next.status = 'defeat'
  return next
}





