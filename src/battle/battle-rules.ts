import type { BattleMode, BattleState, CharacterAbility, CharacterDefinition, CharacterState, EnemyDefinition, EffectType, RuntimeCard } from '../shared/domain-types'
import { makeRuntimeCards } from '../library/card-library'

export const MAX_HAND = 8
export const MAX_SHIELD = 10
export const TURN_DRAW = 5
export const TURN_ENERGY = 3
export const WRONG_DAMAGE = 2
export const FULL_HAND_DAMAGE = 1

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

export function effectDescription(card: RuntimeCard): string {
  const level = card.card.frequencyLevel
  switch (card.card.effectType) {
    case 'attack': return `造成 ${2 + level} 点伤害`
    case 'shield': return `获得 ${3 + level} 点护盾`
    case 'boost': return `下一张攻击或护盾 +${2 + level}`
    case 'draw': return `额外抽 ${1 + Math.floor(level / 2)} 张牌`
    case 'heal': return `回复 ${5 + level} 点生命`
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
  return { ...definition, hp: definition.maxHp, shield: Math.min(MAX_SHIELD, startShield), turns: 0 }
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
    player: { maxHp: characterMaxHp(character), hp: characterMaxHp(character), shield: characterStartShield(character), energy: TURN_ENERGY },
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
  }
  next.log = [summary, ...next.log].slice(0, 8)
  return { state: next, summary }
}

export function applyCardEffect(state: BattleState, card: RuntimeCard): { state: BattleState; summary: string } {
  const next = structuredClone(state) as BattleState
  const level = card.card.frequencyLevel
  const cardBonus = next.character.abilities.filter((ability) => ability.type === 'passive-card-bonus').reduce((sum, ability) => sum + ability.amount, 0)
  const bonus = next.boost
  let summary = ''
  switch (card.card.effectType) {
    case 'attack': {
      const amount = 2 + level + bonus + cardBonus
      const { blocked, damage } = dealDamageToEnemy(next, amount)
      next.boost = 0
      summary = blocked > 0 ? `造成 ${damage} 点伤害，击破 ${blocked} 点护盾` : `对敌人造成 ${amount} 点伤害`
      break
    }
    case 'shield': {
      const amount = 3 + level + bonus + cardBonus
      const result = addPlayerShield(next, amount)
      next.boost = 0
      summary = result.overflow > 0
        ? `护盾达到上限，溢出 ${result.overflow} 点并对敌人造成 ${result.damage} 点伤害`
        : `获得 ${result.gained} 点护盾`
      break
    }
    case 'boost':
      next.boost += 2 + level
      summary = `下一张攻击或护盾牌强化 ${2 + level} 点`
      break
    case 'draw': {
      const amount = 1 + Math.floor(level / 2)
      const needsSpelling = !next.hand.some((item) => item.face === 'spelling')
      next.hand = [...next.hand, ...makeRuntimeCards(next.drawPile.slice(0, amount), Math.random, needsSpelling)].slice(0, MAX_HAND)
      next.drawPile = next.drawPile.slice(Math.min(amount, next.drawPile.length))
      summary = `抽取 ${amount} 张牌`
      break
    }
    case 'heal': {
      const amount = 5 + level
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
  state.enemy.shield -= blocked
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

/** Turn draws are allowed to overflow the hand; each overflow card is discarded for 1 HP. */
export function drawTurnCards(state: BattleState, cards: import('../shared/domain-types').CardRecord[]): { state: BattleState; overflow: number } {
  const next = structuredClone(state) as BattleState
  const availableSlots = Math.max(0, MAX_HAND - next.hand.length)
  const accepted = cards.slice(0, availableSlots)
  const overflow = Math.max(0, cards.length - accepted.length)
  const needsSpelling = !next.hand.some((item) => item.face === 'spelling')
  next.hand = [...next.hand, ...makeRuntimeCards(accepted, Math.random, needsSpelling)]
  next.discardCount += overflow
  next.player.hp = Math.max(0, next.player.hp - overflow * FULL_HAND_DAMAGE)
  if (overflow > 0) {
    next.log = [`手牌已满，${overflow} 张抽到的牌进入弃牌堆，受到 ${overflow * FULL_HAND_DAMAGE} 点伤害。`, ...next.log].slice(0, 8)
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
  const shieldGain = next.enemy.abilities.filter((ability) => ability.type === 'fixed-shield-per-turn').reduce((sum, ability) => sum + ability.amount, 0)
  next.enemy.shield = Math.min(MAX_SHIELD, next.enemy.shield + shieldGain)
  const healGain = next.enemy.abilities.filter((ability) => ability.type === 'heal-per-turn').reduce((sum, ability) => sum + ability.amount, 0)
  next.enemy.hp = Math.min(next.enemy.maxHp, next.enemy.hp + healGain)
  next.enemy.turns = enemyTurn
  const incoming = enemyAttack(next)
  const blocked = Math.min(next.player.shield, incoming)
  const damage = incoming - blocked
  const directDamage = next.enemy.abilities.filter((ability) => ability.type === 'direct-damage-per-turn').reduce((sum, ability) => sum + ability.amount, 0)
  const shieldPiercing = next.player.shield > 0
    ? next.enemy.abilities.filter((ability) => ability.type === 'shield-breaker').reduce((sum, ability) => sum + ability.amount, 0)
    : 0
  next.player.shield = 0
  next.player.hp = Math.max(0, next.player.hp - damage - directDamage - shieldPiercing)
  next.turn += 1
  next.player.energy = TURN_ENERGY
  next.boost = 0
  next.character.cooldowns = Object.fromEntries(Object.entries(next.character.cooldowns).map(([id, cooldown]) => [id, Math.max(0, cooldown - 1)]))
  const passiveHeal = next.character.abilities.filter((ability) => ability.type === 'passive-heal-per-turn').reduce((sum, ability) => sum + ability.amount, 0)
  if (passiveHeal > 0 && next.player.hp > 0) next.player.hp = Math.min(next.player.maxHp, next.player.hp + passiveHeal)
  next.log = [`${next.enemy.name} 攻击 ${incoming} 点，获得 ${shieldGain} 点护盾，恢复 ${healGain} 点生命，额外造成 ${directDamage + shieldPiercing} 点伤害，己方护盾抵挡 ${blocked} 点，受到 ${damage + directDamage + shieldPiercing} 点伤害。`, ...next.log].slice(0, 8)
  if (next.player.hp <= 0) next.status = 'defeat'
  return next
}
