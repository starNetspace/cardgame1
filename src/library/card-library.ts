import type { CampaignConfig, CardFace, CardRecord, CharacterAbility, CharacterConfig, CharacterDefinition, EffectType, FrequencyLevel, LearningStore, ReviewStore, EnemyDefinition } from '../shared/domain-types'

const countryNameMark = '英|美|法|德|意|加|澳|俄|日|西|印|葡|瑞典|土|匈|塞|柬|越|罗|波|捷|沙特|伊朗|埃及|墨西哥|中国'

function isProperNameChunk(chunk: string): boolean {
  if (/人名|地名|电影名|公司名|歌曲名|作品名|书名|诗人|作家|画家|演员|导演|科学家|政治家|总统|国王|女王/.test(chunk)) return true
  if (/姓氏/.test(chunk) && /[（(][^）)]{1,40}[）)]/.test(chunk)) return true
  if (/品牌/.test(chunk) && /(?:皮革|文具|手机|智能|三星|斑马|蔻驰).{0,8}品牌|品牌.{0,8}(?:公司|中文名称)/.test(chunk)) return true
  if (/(?:斑马|蔻驰|三星|Google).{0,8}公司/.test(chunk)) return true
  // Name entries in this dataset commonly use a capitalized English name,
  // followed by a nationality marker and its Chinese transliteration.
  if (new RegExp(`[（(][A-Z][A-Za-z .'-]{1,40}[）)]\\s*[（(](?:${countryNameMark})(?:、(?:${countryNameMark}))*[）)]\\s*[\\u4e00-\\u9fff]{1,20}(?:[（(]姓[）)])?`).test(chunk)) return true
  if (/^[（(][A-Z][A-Za-z .'-]{1,40}[）)]$/.test(chunk.trim())) return true
  // A capitalized name followed by a book, film, or other work title is an
  // appendix rather than a useful dictionary meaning.
  if (/[（(][A-Z][A-Za-z .'-]{1,40}[）)]\s*《[^》]+》/.test(chunk)) return true
  return false
}

function isNameOnlyChunk(chunk: string): boolean {
  const normalized = chunk.replace(/[\s，,。；;]+/g, '')
  if (!normalized) return true
  if (isProperNameChunk(chunk)) return true
  // Dictionary name entries often look like “（英、美）阿福德” without an
  // explicit 人名 suffix. Keep ordinary parenthetical usage annotations.
  return /^[（(][^）)]{1,20}[）)][\u4e00-\u9fff]{1,12}(?:（[^）)]{1,12}）)?$/.test(normalized)
}

function stripEmbeddedProperName(chunk: string): string {
  if (isProperNameChunk(chunk)) return ''
  // Remove an attached name appendix when the ordinary meaning appears
  // before it, e.g. “青年；（Youth）《芳华》（电影名）”.
  return chunk
    .replace(new RegExp(`[（(][A-Z][A-Za-z .'-]{1,40}[）)]\\s*[（(](?:${countryNameMark})(?:、(?:${countryNameMark}))*[）)]\\s*[\\u4e00-\\u9fff]{1,20}(?:[（(]姓[）)])?`, 'g'), '')
    .replace(/[（(][A-Z][A-Za-z .'-]{1,40}[）)]\s*《[^》]+》[^；;]*/g, '')
    .replace(/[（(][A-Z][A-Za-z .'-]{1,40}[）)]\s*(?:（[^）]*电影名[^）]*）|\([^)]*film[^)]*\))/gi, '')
    .trim()
}

export function cleanMeaning(value: string): string {
  const chunks = value
    .split(/[；;]/)
    .map((chunk) => chunk.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map(stripEmbeddedProperName)
    .filter(Boolean)
    .filter((chunk) => !isNameOnlyChunk(chunk))

  return chunks.join('；').trim()
}

function effectForPos(pos: string): EffectType {
  if (['v', 'vt', 'vi', 'vbl', 'modalv', 'v.aux'].includes(pos)) return 'attack'
  if (['n', 'pl'].includes(pos)) return 'shield'
  if (['adj', 'adv/adj'].includes(pos)) return 'boost'
  if (['adv', 'adv/prep'].includes(pos)) return 'draw'
  return 'heal'
}

export function cleanCardRecords(raw: unknown): CardRecord[] {
  if (!Array.isArray(raw)) throw new Error('词卡数据格式不是数组')
  const seen = new Set<string>()
  const output: CardRecord[] = []

  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const source = item as Record<string, unknown>
    const word = typeof source.word === 'string' ? source.word.trim() : ''
    const meaningRaw = typeof source.meaning === 'string' ? source.meaning.trim() : ''
    const pos = typeof source.pos === 'string' ? source.pos.trim().toLowerCase() : 'unknown'
    const level = Number(source.frequencyLevel)
    if (!word || !meaningRaw || !Number.isInteger(level) || level < 1 || level > 5) continue

    const meaning = cleanMeaning(meaningRaw)
    if (!meaning) continue
    const key = `${word.toLowerCase()}|${pos}|${meaning}`
    if (seen.has(key)) continue
    seen.add(key)

    output.push({
      cardId: typeof source.cardId === 'string' ? source.cardId : `card-${output.length + 1}`,
      word,
      phonetic: typeof source.phonetic === 'string' ? source.phonetic : '',
      pos: pos || 'unknown',
      meaning,
      frequencyLevel: level as FrequencyLevel,
      frequencyLabel: typeof source.frequencyLabel === 'string' ? source.frequencyLabel : `等级 ${level}`,
      effectType: effectForPos(pos),
    })
  }
  return output
}

export async function loadCardLibrary(): Promise<CardRecord[]> {
  const response = await fetch('/library/cards/cet6_cards.json')
  if (!response.ok) throw new Error('无法读取 CET-6 词卡数据')
  return cleanCardRecords(await response.json())
}

export function isCampaignConfig(value: unknown): value is CampaignConfig {
  if (!value || typeof value !== 'object') return false
  const candidate = value as CampaignConfig
  return Number.isInteger(candidate.version) && candidate.version > 0 && isCampaignModeConfig(candidate.practice) && isCampaignModeConfig(candidate.learning)
}

function isCampaignModeConfig(value: unknown): boolean {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { sets?: unknown }).sets)) return false
  if ((value as { sets: unknown[] }).sets.length === 0) return false
  return (value as { sets: unknown[] }).sets.every((set) => {
    if (!set || typeof set !== 'object') return false
    const source = set as { id?: unknown; title?: unknown; description?: unknown; enemies?: unknown }
    if (typeof source.id !== 'string' || source.id.trim().length === 0 || typeof source.title !== 'string' || source.title.trim().length === 0 || typeof source.description !== 'string' || Array.isArray(source.enemies) === false || source.enemies.length === 0 || !source.enemies.every(isEnemyDefinition)) return false
    const finalIndexes = source.enemies.map((enemy, index) => enemy && typeof enemy === 'object' && (enemy as { isFinal?: unknown }).isFinal === true ? index : -1).filter((index) => index >= 0)
    return finalIndexes.length === 1 && finalIndexes[0] === source.enemies.length - 1
  })
}

export function isEnemyDefinition(value: unknown): value is EnemyDefinition {
  if (!value || typeof value !== 'object') return false
  const enemy = value as Record<string, unknown>
  if (enemy.icon !== undefined && !['skull', 'flame', 'eye', 'crown', 'zap', 'shield'].includes(enemy.icon as string)) return false
  if (!['id', 'name', 'subtitle'].every((key) => typeof enemy[key] === 'string' && (enemy[key] as string).trim().length > 0)) return false
  if (enemy.alias !== undefined && (typeof enemy.alias !== 'string' || enemy.alias.trim().length === 0)) return false
  if (enemy.avatar !== undefined && !isAvatarPath(enemy.avatar)) return false
  if (!Number.isInteger(enemy.maxHp) || (enemy.maxHp as number) <= 0) return false
  if (!Number.isInteger(enemy.attack) || (enemy.attack as number) < 0) return false
  if (enemy.shield !== undefined && (!Number.isInteger(enemy.shield) || (enemy.shield as number) < 0)) return false
  if (enemy.isFinal !== undefined && typeof enemy.isFinal !== 'boolean') return false
  if (!Array.isArray(enemy.abilities)) return false
  return enemy.abilities.every((ability) => {
    if (!ability || typeof ability !== 'object') return false
    const item = ability as Record<string, unknown>
    if (!['fixed-shield-per-turn', 'attack-scaling', 'start-shield', 'heal-per-turn', 'enrage', 'direct-damage-per-turn', 'shield-breaker'].includes(item.type as string) || !Number.isInteger(item.amount) || (item.amount as number) < 0 || typeof item.description !== 'string' || item.description.trim().length === 0) return false
    if (item.type === 'attack-scaling' && (!Number.isInteger(item.everyTurns) || (item.everyTurns as number) <= 0)) return false
    if (item.type === 'enrage' && (typeof item.threshold !== 'number' || item.threshold <= 0 || item.threshold >= 1)) return false
    if (item.threshold !== undefined && (typeof item.threshold !== 'number' || item.threshold <= 0 || item.threshold >= 1)) return false
    return item.everyTurns === undefined || (Number.isInteger(item.everyTurns) && (item.everyTurns as number) > 0)
  })
}

export async function loadCampaignConfig(): Promise<CampaignConfig> {
  const response = await fetch('/library/campaigns.json')
  if (!response.ok) throw new Error('无法读取战役敌人配置')
  const config: unknown = await response.json()
  if (!isCampaignConfig(config)) throw new Error('战役敌人配置格式不正确')
  return config
}

export function isCharacterDefinition(value: unknown): value is CharacterDefinition {
  if (!value || typeof value !== 'object') return false
  const character = value as Record<string, unknown>
  if (character.icon !== undefined && !['skull', 'flame', 'eye', 'crown', 'zap', 'shield'].includes(character.icon as string)) return false
  if (!['id', 'name', 'subtitle'].every((key) => typeof character[key] === 'string' && (character[key] as string).trim().length > 0)) return false
  if (character.alias !== undefined && (typeof character.alias !== 'string' || character.alias.trim().length === 0)) return false
  if (character.avatar !== undefined && !isAvatarPath(character.avatar)) return false
  if (!Number.isInteger(character.maxHp) || (character.maxHp as number) <= 0) return false
  if (character.shield !== undefined && (!Number.isInteger(character.shield) || (character.shield as number) < 0)) return false
  if (!Array.isArray(character.abilities)) return false
  const abilityIds = new Set<string>()
  return character.abilities.every((ability) => {
    if (!isCharacterAbility(ability)) return false
    if (abilityIds.has(ability.id)) return false
    abilityIds.add(ability.id)
    return true
  })
}

function isAvatarPath(value: unknown): value is string {
  return typeof value === 'string' && /^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.(?:png|jpe?g|webp)$/i.test(value.trim())
}

export function isCharacterAbility(value: unknown): value is CharacterAbility {
  if (!value || typeof value !== 'object') return false
  const ability = value as Record<string, unknown>
  const passiveTypes = ['passive-start-shield', 'passive-max-hp', 'passive-heal-per-turn', 'passive-card-bonus']
  const activeTypes = ['active-heal', 'active-shield', 'active-damage']
  if (typeof ability.id !== 'string' || ability.id.trim().length === 0) return false
  if (!['passive', 'active'].includes(ability.kind as string)) return false
  if (![...passiveTypes, ...activeTypes].includes(ability.type as string)) return false
  if (ability.kind === 'passive' && !passiveTypes.includes(ability.type as string)) return false
  if (ability.kind === 'active' && !activeTypes.includes(ability.type as string)) return false
  if (!Number.isInteger(ability.amount) || (ability.amount as number) <= 0) return false
  if (ability.kind === 'active' && (!Number.isInteger(ability.cooldown) || (ability.cooldown as number) <= 0)) return false
  if (ability.cooldown !== undefined && (!Number.isInteger(ability.cooldown) || (ability.cooldown as number) <= 0)) return false
  return typeof ability.description === 'string' && ability.description.trim().length > 0
}

export function isCharacterConfig(value: unknown): value is CharacterConfig {
  if (!value || typeof value !== 'object') return false
  const config = value as CharacterConfig
  if (!Number.isInteger(config.version) || config.version <= 0 || !Array.isArray(config.characters) || config.characters.length === 0) return false
  if (config.selectedCharacterId !== undefined && (typeof config.selectedCharacterId !== 'string' || !config.selectedCharacterId.trim())) return false
  const ids = new Set<string>()
  const validCharacters = config.characters.every((character) => isCharacterDefinition(character) && !ids.has(character.id) && Boolean(ids.add(character.id)))
  return validCharacters && (config.selectedCharacterId === undefined || ids.has(config.selectedCharacterId))
}

export async function loadCharacterConfig(): Promise<CharacterConfig> {
  const response = await fetch('/library/characters.json')
  if (!response.ok) throw new Error('无法读取角色配置')
  const config: unknown = await response.json()
  if (!isCharacterConfig(config)) throw new Error('角色配置格式不正确')
  return config
}

export function campaignEnemies(config: CampaignConfig, mode: 'practice' | 'learning'): EnemyDefinition[] {
  return config[mode].sets.flatMap((set) => set.enemies)
}

export function chooseCampaignEnemies(config: CampaignConfig, mode: 'practice' | 'learning', route: 'set' | 'all', random: () => number = Math.random): { enemies: EnemyDefinition[]; setId?: string } {
  const modeConfig = config[mode]
  if (route === 'set') {
    const set = modeConfig.sets[Math.floor(random() * modeConfig.sets.length)] ?? modeConfig.sets[0]
    return { enemies: set ? set.enemies.map((enemy, index) => ({ ...enemy, isFinal: index === set.enemies.length - 1 })) : [], setId: set?.id }
  }
  const pool = [...campaignEnemies(config, mode)]
  const selected: EnemyDefinition[] = []
  while (pool.length > 0 && selected.length < 5) {
    const index = Math.floor(random() * pool.length)
    selected.push(pool.splice(index, 1)[0])
  }
  return { enemies: selected.map((enemy, index) => ({ ...enemy, isFinal: index === selected.length - 1 })) }
}

function randomIndex(max: number, random: () => number): number {
  return Math.floor(random() * max)
}

export function getCardWeight(card: CardRecord, review: ReviewStore, now: number): number {
  const record = review[card.cardId]
  if (!record) return 4
  const errorCount = record.incorrect
  const errorBonus = errorCount === 0 ? 0 : errorCount === 1 ? 0.1 : errorCount === 2 ? 0.4 : errorCount === 3 ? 1 : 3 + Math.min(errorCount - 4, 3) * 0.35
  const correctPenalty = Math.min(record.correct * 0.35, 1.75)
  const dueBonus = now - record.lastSeenAt > 1000 * 60 * 60 * 24 * 3 ? 3 : 0
  const recentWrongBonus = !record.lastCorrect && now - record.lastSeenAt < 1000 * 60 * 60 * 24 * 2 ? 1 : 0
  return Math.max(0.5, 4 - correctPenalty + errorBonus + dueBonus + recentWrongBonus)
}

export function drawCards(
  library: CardRecord[],
  review: ReviewStore,
  count: number,
  random: () => number = Math.random,
  now = Date.now(),
): CardRecord[] {
  const pool = [...library]
  const result: CardRecord[] = []
  const usedWords = new Set<string>()
  while (pool.length > 0 && result.length < count) {
    const candidates = pool.filter((card) => !usedWords.has(card.word.toLowerCase()))
    const available = candidates.length > 0 ? candidates : pool
    const totalWeight = available.reduce((sum, card) => sum + getCardWeight(card, review, now), 0)
    let target = random() * totalWeight
    let chosen = available[available.length - 1]
    for (const card of available) {
      target -= getCardWeight(card, review, now)
      if (target <= 0) {
        chosen = card
        break
      }
    }
    result.push(chosen)
    const poolIndex = pool.findIndex((card) => card.cardId === chosen.cardId)
    pool.splice(poolIndex, 1)
    usedWords.add(chosen.word.toLowerCase())
  }
  return result
}

export function getLearningCardWeight(
  card: CardRecord,
  learning: LearningStore,
  deckId: string,
  pendingCounts: Record<string, number>,
  recentIncorrectAt: Record<string, number>,
  now: number,
): number {
  const memory = learning.cards[`${deckId}|${card.cardId}`]
  const incorrectCount = memory?.incorrectCount ?? 0
  const lastIncorrectAt = Math.max(memory?.lastIncorrectAt ?? 0, recentIncorrectAt[card.cardId] ?? 0)
  const age = lastIncorrectAt > 0 ? now - lastIncorrectAt : Number.POSITIVE_INFINITY
  const recencyBonus = age <= 5 * 60 * 1000 ? 8
    : age <= 30 * 60 * 1000 ? 5
      : age <= 6 * 60 * 60 * 1000 ? 3
        : age <= 2 * 24 * 60 * 60 * 1000 ? 1.5
          : 0
  const errorBonus = Math.min(incorrectCount, 6) * 0.6
  const pendingBonus = Math.max(0, (pendingCounts[card.cardId] ?? 1) - 1) * 0.8
  return 1 + recencyBonus + errorBonus + pendingBonus
}

export function drawLearningCards(
  library: CardRecord[],
  learning: LearningStore,
  deckId: string,
  pendingCounts: Record<string, number>,
  recentIncorrectAt: Record<string, number>,
  count: number,
  random: () => number = Math.random,
  now = Date.now(),
): CardRecord[] {
  const pool = [...library]
  const result: CardRecord[] = []
  const usedWords = new Set<string>()
  while (pool.length > 0 && result.length < count) {
    const candidates = pool.filter((card) => !usedWords.has(card.word.toLowerCase()))
    const available = candidates.length > 0 ? candidates : pool
    const totalWeight = available.reduce((sum, card) => sum + getLearningCardWeight(card, learning, deckId, pendingCounts, recentIncorrectAt, now), 0)
    let target = random() * totalWeight
    let chosen = available[available.length - 1]
    for (const card of available) {
      target -= getLearningCardWeight(card, learning, deckId, pendingCounts, recentIncorrectAt, now)
      if (target <= 0) {
        chosen = card
        break
      }
    }
    result.push(chosen)
    pool.splice(pool.findIndex((card) => card.cardId === chosen.cardId), 1)
    usedWords.add(chosen.word.toLowerCase())
  }
  return result
}

export function makeRuntimeCards(cards: CardRecord[], random: () => number = Math.random, ensureSpelling = cards.length > 1): import('../shared/domain-types').RuntimeCard[] {
  const runtimeCards = cards.map((card, index) => ({
    card,
    instanceId: `${card.cardId}-${Date.now()}-${index}`,
    face: (random() < 0.6 ? 'meaning' : 'spelling') as CardFace,
  }))

  // A fresh hand must always offer both study modes when there is room for them.
  // Keep the random assignment, but avoid an all-meaning opening hand.
  if (ensureSpelling && runtimeCards.length > 0 && runtimeCards.every((card) => card.face === 'meaning')) {
    const forcedIndex = Math.floor(random() * runtimeCards.length)
    runtimeCards[forcedIndex].face = 'spelling'
  }

  return runtimeCards
}
