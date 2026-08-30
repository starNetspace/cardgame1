import { useEffect, useMemo, useState } from 'react'
import { BarChart3, BookOpen, Check, ChevronRight, CircleHelp, Crosshair, Download, Eye, Flame, Heart, LogOut, Crown, RotateCcw, Search, Shield, Sparkles, Swords, Target, Trash2, Upload, UserRound, Volume2, X, Zap } from 'lucide-react'
import { buildQuestion, isSpellingCorrect } from './game/questions'
import { loadCardLibrary, loadCampaignConfig, loadCharacterConfig, chooseCampaignEnemies, drawCards, drawLearningCards, makeRuntimeCards } from './game/data'
import { createAccount, createAccountExport, deleteAccount, importAccountData, loadAccountRegistry, parseAccountExport, saveAccountRegistry, switchAccount } from './game/accounts'
import { allReviewStats, clearBattleState, clearLearningBattleState, completeLearningDeck, createReviewSession, getCardMemorySummary, getDueCardIds, getLearningMistakes, getNextDueAt, getReviewMistakes, getTodayLearnedCount, isValidMistakePracticeCount, limitMistakeIds, loadBattleStore, loadCardMemoryStore, loadLearningStore, loadReviewStore, planDeal, recordAnswer, resetDeckLearningMemory, saveBattleState, saveCardMemoryStore, saveLearningStore, saveReviewStore, settleUnshownRequeue, startLearningSession, updateCardMemory, updateLearningMemory, updateReview } from './game/review'
import { activeCharacterAbilities, advanceCampaignEnemy, applyCardEffect, canCompleteLearningDeck, campaignEnemyProgress, createBattle, drawTurnCards, effectDescription, effectLabel, enemyAttack, finishEnemyTurn, markLearningCardCorrect, MAX_HAND, MAX_SHIELD, protectLearningBattle, returnLearningCardToQueue, TURN_DRAW, useCharacterAbility, WRONG_DAMAGE } from './game/rules'
import { loadAudioManifest, speakWord } from './game/speech'
import { buildStudyDecks, getDeckProgress, getDefaultDeck } from './game/decks'
import type { AccountRegistry, BattleMode, BattleState, BattleStore, CampaignConfig, CampaignRoute, CardMemoryAnswerSource, CardMemoryQuality, CardRecord, CardSource, CharacterConfig, EnemyDefinition, EnemyIcon, LearningStore, QuestionState, ReviewSession, ReviewStore, RuntimeCard, StudyDeck } from './types'
import './styles.css'

type View = 'menu' | 'modes' | 'learning-decks' | 'campaign-setup' | 'character-select' | 'battle' | 'result' | 'stats' | 'library' | 'mistakes' | 'accounts'
type MistakeBookPage = 'choose' | 'all'
type CampaignStart = { mode: 'practice' | 'learning' | 'mistakes'; deckId?: string; mistakeSource?: 'practice' | 'learning' | 'all'; mistakeMaxCount?: number; characterId?: string }

function percent(value: number, total: number): string {
  return total === 0 ? '0%' : `${Math.round((value / total) * 100)}%`
}

function IconForEffect({ type }: { type: RuntimeCard['card']['effectType'] }) {
  if (type === 'attack') return <Crosshair size={15} />
  if (type === 'shield') return <Shield size={15} />
  if (type === 'boost') return <Sparkles size={15} />
  if (type === 'draw') return <BookOpen size={15} />
  return <Heart size={15} />
}

function IconForEnemy({ icon, size = 42 }: { icon: EnemyIcon; size?: number }) {
  const props = { size, strokeWidth: 1.5 }
  if (icon === 'eye') return <Eye {...props} />
  if (icon === 'flame') return <Flame {...props} />
  if (icon === 'crown') return <Crown {...props} />
  if (icon === 'zap') return <Zap {...props} />
  if (icon === 'shield') return <Shield {...props} />
  return <CircleHelp {...props} />
}

function Portrait({ avatar, icon, size = 42 }: { avatar?: string; icon: EnemyIcon; size?: number }) {
  const [imageFailed, setImageFailed] = useState(false)
  if (!avatar || imageFailed) return <IconForEnemy icon={icon} size={size} />
  return <img className="avatar-image" src={`/icon/${avatar}`} alt="" onError={() => setImageFailed(true)} />
}

function ProgressBar({ value, max, tone }: { value: number; max: number; tone: 'red' | 'green' | 'blue' }) {
  return <div className={`progress-track ${tone}`}><span style={{ width: `${Math.max(0, Math.min(100, (value / max) * 100))}%` }} /></div>
}

export default function App() {
  const [view, setView] = useState<View>('menu')
  const [accountRegistry, setAccountRegistry] = useState<AccountRegistry>(() => loadAccountRegistry())
  const [library, setLibrary] = useState<CardRecord[]>([])
  const [campaignConfig, setCampaignConfig] = useState<CampaignConfig | null>(null)
  const [characterConfig, setCharacterConfig] = useState<CharacterConfig | null>(null)
  const [review, setReview] = useState<ReviewStore>(() => loadReviewStore())
  const [cardMemory, setCardMemory] = useState(() => loadCardMemoryStore())
  const [battleStore, setBattleStore] = useState<BattleStore>(() => loadBattleStore())
  const [learningStore, setLearningStore] = useState<LearningStore>(() => loadLearningStore())
  const [activeMode, setActiveMode] = useState<BattleMode>('practice')
  const [battle, setBattle] = useState<BattleState | null>(null)
  const [question, setQuestion] = useState<QuestionState | null>(null)
  const [answer, setAnswer] = useState('')
  const [selectedOption, setSelectedOption] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<{ correct: boolean; text: string; abandoned?: boolean } | null>(null)
  const [mistakeBookPage, setMistakeBookPage] = useState<MistakeBookPage>('choose')
  const [campaignStart, setCampaignStart] = useState<CampaignStart | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reviewSession, setReviewSession] = useState<ReviewSession>(() => createReviewSession())
  const [cardMeta, setCardMeta] = useState<Record<string, { source: CardSource; quality?: CardMemoryQuality }>>({})
  const [reviewRunRemaining, setReviewRunRemaining] = useState(0)
  const [reviewRunStats, setReviewRunStats] = useState({ reviewed: 0, upgraded: 0, downgraded: 0 })

  useEffect(() => {
    void loadAudioManifest()
    Promise.all([loadCardLibrary(), loadCampaignConfig(), loadCharacterConfig()]).then(([cards, campaigns, characters]) => {
      setLibrary(cards)
      setCampaignConfig(campaigns)
      setCharacterConfig(characters)
      const knownCards = new Set(cards.map((card) => card.cardId))
      setBattleStore((current) => {
        const next: BattleStore = { practice: current.practice, online: current.online }
        if (current.learning) {
          next.learning = Object.fromEntries(Object.entries(current.learning).map(([deckId, saved]) => [deckId, {
            ...saved,
            hand: saved.hand.filter((item) => knownCards.has(item.card.cardId)),
            drawPile: saved.drawPile.filter((item) => knownCards.has(item.cardId)),
          }]))
        }
        for (const mode of ['practice', 'online'] as const) {
          const saved = current[mode]
          if (saved) next[mode] = { ...saved, hand: saved.hand.filter((item) => knownCards.has(item.card.cardId)), drawPile: saved.drawPile.filter((item) => knownCards.has(item.cardId)) }
        }
        return next
      })
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : '游戏数据载入失败')).finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!battle) return
    if (battle.reviewRun) return
    if (battle.status === 'playing' && battle.player.hp > 0 && battle.enemy.hp > 0) {
      saveBattleState(battle.mode, battle)
      setBattleStore((current) => battle.mode === 'learning' && battle.learningDeckId
        ? { ...current, learning: { ...(current.learning ?? {}), [battle.learningDeckId]: battle } }
        : { ...current, [battle.mode]: battle })
      return
    }
    // Finished battles must never remain resumable as stale end states.
    if (battle.mode === 'learning' && battle.learningDeckId) {
      clearLearningBattleState(battle.learningDeckId)
      setBattleStore((current) => {
        const learning = { ...(current.learning ?? {}) }
        delete learning[battle.learningDeckId as string]
        return Object.keys(learning).length > 0 ? { ...current, learning } : { practice: current.practice, online: current.online }
      })
    } else {
      clearBattleState(battle.mode)
      setBattleStore((current) => {
        const next = { ...current }
        delete next[battle.mode]
        return next
      })
    }
  }, [battle])

  const stats = useMemo(() => allReviewStats(review), [review])
  const studyDecks = useMemo(() => buildStudyDecks(library), [library])

  function openModeSelect() {
    setQuestion(null)
    setFeedback(null)
    setView('modes')
  }

  function openAccounts() {
    setQuestion(null)
    setFeedback(null)
    setView('accounts')
  }

  function refreshAccountState() {
    setReview(loadReviewStore())
    setCardMemory(loadCardMemoryStore())
    setLearningStore(loadLearningStore())
    setBattleStore(loadBattleStore())
    setBattle(null)
    setQuestion(null)
    setFeedback(null)
  }

  function activateAccount(next: AccountRegistry) {
    setAccountRegistry(next)
    refreshAccountState()
    setView('menu')
  }

  function createUserAccount(username: string) {
    const next = createAccount(accountRegistry, username)
    if (next) activateAccount(next)
  }

  function switchUserAccount(username: string) {
    const next = switchAccount(accountRegistry, username)
    if (next) activateAccount(next)
  }

  function removeUserAccount(username: string) {
    const next = deleteAccount(accountRegistry, username)
    setAccountRegistry(next)
    refreshAccountState()
  }

  function exportUserAccount() {
    const data = createAccountExport(accountRegistry.activeUsername)
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `lexicon-duel-${accountRegistry.activeUsername}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  function importUserAccount(file: File): Promise<boolean> {
    return new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = () => {
        try {
          const parsed = parseAccountExport(JSON.parse(String(reader.result)))
          const next = parsed && importAccountData(accountRegistry, parsed)
          if (next) {
            activateAccount(next)
            resolve(true)
            return
          }
        } catch { /* invalid files leave the current account untouched */ }
        resolve(false)
      }
      reader.onerror = () => resolve(false)
      reader.readAsText(file)
    })
  }

  function openCampaignSetup(start: CampaignStart) {
    setCampaignStart(start)
    setQuestion(null)
    setFeedback(null)
    setView('campaign-setup')
  }

  function startPractice() {
    if (library.length > 0) openCampaignSetup({ mode: 'practice' })
  }

  function resolveCardRecords(ids: string[]): CardRecord[] {
    const cards: CardRecord[] = []
    for (const id of ids) {
      const card = library.find((item) => item.cardId === id)
      if (!card) console.error(`复习/重现卡 cardId 失配，跳过：${id}`)
      else cards.push(card)
    }
    return cards
  }

  function dueCardRecords(now = Date.now()): CardRecord[] {
    return resolveCardRecords(getDueCardIds(cardMemory, now))
  }

  function dealHand(newPool: CardRecord[], duePool: CardRecord[], fourNewOneOld: boolean, desired: number, now = Date.now()): { cards: CardRecord[]; meta: Array<{ source: CardSource; quality?: CardMemoryQuality }>; nextSession: ReviewSession; deckIds: Set<string> } {
    const dueIdSet = new Set(duePool.map((card) => card.cardId))
    const newCandidates = fourNewOneOld ? drawCards(newPool.filter((card) => !dueIdSet.has(card.cardId)), review, desired) : []
    const { dealt, nextSession } = planDeal(reviewSession, newCandidates.map((card) => card.cardId), duePool.map((card) => card.cardId), desired, { fourNewOneOld })
    const deckIds = new Set<string>()
    const cards: CardRecord[] = []
    const meta: Array<{ source: CardSource; quality?: CardMemoryQuality }> = []
    for (const item of dealt) {
      const card = library.find((c) => c.cardId === item.cardId)
      if (!card) { console.error(`复习/重现卡 cardId 失配，跳过：${item.cardId}`); continue }
      cards.push(card)
      meta.push({ source: item.source, quality: cardMemory[item.cardId]?.quality })
      if (fourNewOneOld ? item.source === 'new' : item.source === 'due') deckIds.add(item.cardId)
    }
    return { cards, meta, nextSession, deckIds }
  }

  const reviewEnemy: EnemyDefinition = { id: 'review-guard', name: 'REVIEW GUARD', subtitle: '到期复习', icon: 'shield', maxHp: 999999, attack: 0, shield: 0, abilities: [] }

  function startReviewRun() {
    if (library.length === 0) return
    const dueCards = resolveCardRecords(getDueCardIds(cardMemory)).slice(0, 20)
    if (dueCards.length === 0) return
    const openingCount = Math.min(TURN_DRAW, dueCards.length)
    const opening = dueCards.slice(0, openingCount)
    const drawPile = dueCards.slice(openingCount)
    const openingRuntime = makeRuntimeCards(opening)
    const character = characterConfig?.characters[0]
    const next = createBattle(drawPile, openingRuntime, 'practice', reviewEnemy, character)
    next.reviewRun = true
    clearBattleState('practice')
    setBattleStore((current) => { const store = { ...current }; delete store.practice; return store })
    setActiveMode('practice')
    setReviewSession(createReviewSession())
    setCardMeta(Object.fromEntries(opening.map((card) => [card.cardId, { source: 'due' as CardSource, quality: cardMemory[card.cardId]?.quality }])))
    setReviewRunRemaining(dueCards.length)
    setReviewRunStats({ reviewed: 0, upgraded: 0, downgraded: 0 })
    setBattle(next)
    setQuestion(null)
    setFeedback(null)
    setView('battle')
  }

  function settleReviewSession() {
    setCardMemory((current) => {
      const settled = settleUnshownRequeue(current, reviewSession, Date.now())
      if (settled !== current) saveCardMemoryStore(settled)
      return settled
    })
  }

  function startCampaign(start: CampaignStart, route: CampaignRoute, characterId: string) {
    if (!campaignConfig || !characterConfig || library.length === 0) return
    const configMode = start.mode === 'practice' ? 'practice' : 'learning'
    const chosen = chooseCampaignEnemies(campaignConfig, configMode, route)
    const firstEnemy = chosen.enemies[0]
    if (!firstEnemy) return
    const character = characterConfig.characters.find((item) => item.id === characterId) ?? characterConfig.characters[0]
    if (!character) return
    let targetIds: string[] = library.map((card) => card.cardId)
    if (start.mode === 'learning') {
      const deck = studyDecks.find((item) => item.deckId === start.deckId)
      if (!deck) return
      const progress = learningStore.decks[deck.deckId]
      const remaining = progress?.masteredCardIds.length ? deck.cardIds.filter((id) => !progress.masteredCardIds.includes(id)) : deck.cardIds
      targetIds = remaining.length > 0 ? remaining : deck.cardIds
    } else if (start.mode === 'mistakes') {
      const practiceIds = start.mistakeSource === 'learning' ? [] : getReviewMistakes(review).map((record) => record.cardId)
      const learningIds = start.mistakeSource === 'practice' ? [] : [...new Set(getLearningMistakes(learningStore).map((memory) => memory.cardId))]
      const ids = start.mistakeSource === 'practice' ? practiceIds : start.mistakeSource === 'learning' ? learningIds : [...new Set([...practiceIds, ...learningIds])]
      targetIds = limitMistakeIds(ids, start.mistakeMaxCount)
    }
    const targetCards = targetIds.map((id) => library.find((card) => card.cardId === id)).filter(Boolean) as CardRecord[]
    if (targetCards.length === 0) return
    const initialPendingCounts = start.mode === 'learning'
      ? Object.fromEntries(targetIds.map((cardId) => [cardId, Math.max(1, (learningStore.cards[`${start.deckId}|${cardId}`]?.incorrectCount ?? 0) + 1)]))
      : {}
    const desired = Math.min(TURN_DRAW, targetCards.length)
    let opening: CardRecord[]
    let openingRuntime: RuntimeCard[]
    let drawPile: CardRecord[]
    let openingMeta: Array<{ source: CardSource; quality?: CardMemoryQuality }> = []
    let nextSession = reviewSession
    if (start.mode === 'practice') {
      const result = dealHand(targetCards, dueCardRecords(), true, desired)
      opening = result.cards
      openingRuntime = makeRuntimeCards(opening)
      drawPile = targetCards.filter((card) => !result.deckIds.has(card.cardId))
      openingMeta = result.meta
      nextSession = result.nextSession
    } else if (start.mode === 'learning') {
      opening = drawLearningCards(targetCards, learningStore, start.deckId as string, initialPendingCounts, {}, desired)
      openingRuntime = makeRuntimeCards(opening)
      drawPile = targetCards.filter((card) => !new Set(opening.map((item) => item.cardId)).has(card.cardId))
    } else {
      opening = drawCards(targetCards, review, desired)
      openingRuntime = makeRuntimeCards(opening)
      drawPile = targetCards.filter((card) => !new Set(opening.map((item) => item.cardId)).has(card.cardId))
    }
    const next = createBattle(drawPile, openingRuntime, start.mode === 'learning' ? 'learning' : 'practice', firstEnemy, character)
    next.campaignGoal = start.mode === 'practice' ? 'defeat-all' : 'learn-all'
    next.campaignSetId = chosen.setId
    next.campaignEnemyQueue = chosen.enemies
    next.campaignEnemyIndex = 0
    next.learningCardIds = [...targetIds]
    next.learningRemainingCardIds = [...targetIds]
    next.learningPendingCounts = initialPendingCounts
    next.learningLastIncorrectAt = {}
    if (start.mode === 'learning') {
      next.learningDeckId = start.deckId
      if (!start.deckId) return
      next.learningRemainingCardIds = [...next.learningCardIds]
      const nextLearning = startLearningSession(learningStore, start.deckId)
      setLearningStore(nextLearning)
      saveLearningStore(nextLearning)
    } else if (start.mode === 'mistakes') {
      next.mistakeSource = start.mistakeSource
      next.mistakePracticeCardIds = start.mistakeSource === 'learning' ? [] : getReviewMistakes(review).map((record) => record.cardId)
      next.mistakeLearningCardIds = start.mistakeSource === 'practice' ? [] : [...new Set(getLearningMistakes(learningStore).map((memory) => memory.cardId))]
    }
    if (start.mode === 'learning') clearLearningBattleState(start.deckId as string)
    else clearBattleState('practice')
    setBattleStore((current) => {
      const nextStore = { ...current }
      if (start.mode === 'learning') {
        const learning = { ...(nextStore.learning ?? {}) }
        delete learning[start.deckId as string]
        nextStore.learning = learning
      } else delete nextStore.practice
      return nextStore
    })
    setActiveMode(start.mode === 'learning' ? 'learning' : 'practice')
    if (start.mode === 'practice') {
      setReviewSession(nextSession)
      setCardMeta(Object.fromEntries(opening.map((card, index) => [card.cardId, openingMeta[index] ?? { source: 'new' as CardSource }])))
    } else {
      setReviewSession(createReviewSession())
      setCardMeta({})
    }
    setReviewRunRemaining(0)
    setReviewRunStats({ reviewed: 0, upgraded: 0, downgraded: 0 })
    setBattle(next)
    setQuestion(null)
    setFeedback(null)
    setView('battle')
  }

  function openLearningDecks() {
    setQuestion(null)
    setFeedback(null)
    setView('learning-decks')
  }

  function startLearning(deck: StudyDeck) {
    if (deck.totalCards > 0) openCampaignSetup({ mode: 'learning', deckId: deck.deckId })
  }

  function continueBattle(mode: BattleMode) {
    const saved = mode === 'learning' ? undefined : battleStore[mode]
    if (!saved || saved.status !== 'playing') return
    setActiveMode(mode)
    setBattle(saved)
    setQuestion(null)
    setFeedback(null)
    setView('battle')
  }

  function continueLearning(deckId: string) {
    const saved = battleStore.learning?.[deckId]
    if (!saved || saved.status !== 'playing') {
      const deck = studyDecks.find((item) => item.deckId === deckId)
      if (deck) startLearning(deck)
      return
    }
    setActiveMode('learning')
    setBattle(saved)
    setQuestion(null)
    setFeedback(null)
    setView('battle')
  }

  function exitBattle() {
    if (battle) {
      settleReviewSession()
      if (battle.reviewRun) {
        clearBattleState(activeMode)
        setBattleStore((current) => { const next = { ...current }; delete next[activeMode]; return next })
      } else if (battle.status === 'playing') {
        saveBattleState(activeMode, battle)
        setBattleStore((current) => activeMode === 'learning' && battle.learningDeckId
          ? { ...current, learning: { ...(current.learning ?? {}), [battle.learningDeckId]: battle } }
          : { ...current, [activeMode]: battle })
      } else if (activeMode === 'learning' && battle.learningDeckId) {
        clearLearningBattleState(battle.learningDeckId)
      } else {
        clearBattleState(activeMode)
      }
    }
    setQuestion(null)
    setFeedback(null)
    setView(activeMode === 'learning' ? 'learning-decks' : battle?.reviewRun || battle?.mistakeSource ? 'mistakes' : 'modes')
  }

  function deleteSavedBattle(mode: BattleMode) {
    clearBattleState(mode)
    setBattleStore((current) => { const next = { ...current }; delete next[mode]; return next })
  }

  function deleteLearningBattle(deckId: string) {
    clearLearningBattleState(deckId)
    setBattleStore((current) => {
      const next = { ...current, learning: { ...(current.learning ?? {}) } }
      delete next.learning?.[deckId]
      return next
    })
  }

  function deleteLearningMemory(deckId: string) {
    const next = resetDeckLearningMemory(learningStore, deckId)
    setLearningStore(next)
    saveLearningStore(next)
  }

  function beginQuestion(card: RuntimeCard) {
    if (!battle || battle.status !== 'playing' || question || feedback) return
    setQuestion(buildQuestion(card, library))
    setAnswer('')
    setSelectedOption(null)
  }

  function completeAnswer(correct: boolean, abandoned = false) {
    if (!battle || !question || feedback) return
    const card = question.card
    const source: CardMemoryAnswerSource = cardMeta[card.card.cardId]?.source === 'requeue' ? 'requeue' : 'due'
    let next = structuredClone(battle) as BattleState
    next.totalAnswers += 1
    next.usedCards += 1
    const isPass = next.player.energy <= 0
    if (!isPass) next.player.energy -= 1
    next.faceStats[card.face].total += 1
    next.log = [`${card.card.word} · ${abandoned ? '已放弃' : correct ? '答对' : '答错'}`, ...next.log].slice(0, 8)
    if (correct && (next.learningDeckId || next.campaignGoal === 'learn-all')) next = markLearningCardCorrect(next, card)
    if (correct) {
      next.correctAnswers += 1
      next.faceStats[card.face].correct += 1
      if (isPass) {
        next.log = [`${card.card.word} · 过牌答对，效果不生效`, ...next.log].slice(0, 8)
      } else {
        const effect = applyCardEffect(next, card)
        next = effect.state
        next = protectLearningBattle(next)
        next.log = [`${effectLabel(card.card.effectType)}：${effect.summary}`, ...next.log].slice(0, 8)
      }
    } else {
      next.player.hp = Math.max(0, next.player.hp - WRONG_DAMAGE)
      next.errorCardIds = [...new Set([...next.errorCardIds, card.card.cardId])]
      next.log = [`${abandoned ? '跳过拼写题' : '答题错误'}，受到 ${WRONG_DAMAGE} 点直接伤害。`, ...next.log].slice(0, 8)
      next = returnLearningCardToQueue(next, card)
    }
    if (next.player.hp <= 0) next.status = 'defeat'
    next.hand = next.hand.filter((item) => item.instanceId !== card.instanceId)
    next.discardCount += 1
    if (activeMode === 'learning' && next.learningDeckId) {
      const isMastered = correct && (next.learningPendingCounts?.[card.card.cardId] ?? 0) <= 0
      const nextLearning = updateLearningMemory(learningStore, next.learningDeckId, card.card.cardId, correct, Date.now(), isMastered)
      setLearningStore(nextLearning)
      saveLearningStore(nextLearning)
      if (correct && canCompleteLearningDeck(next)) {
        const completed = completeLearningDeck(nextLearning, next.learningDeckId, Date.now())
        setLearningStore(completed)
        saveLearningStore(completed)
        next.status = 'victory'
        clearLearningBattleState(next.learningDeckId)
      }
    } else {
      const isLearningMistakePractice = next.mistakeSource === 'learning'
      const practiceCardIds = next.mistakePracticeCardIds ?? []
      const shouldUpdatePracticeReview = !isLearningMistakePractice && (next.mistakeSource !== 'all' || practiceCardIds.includes(card.card.cardId))
      const nextReview = shouldUpdatePracticeReview ? updateReview(review, card.card.cardId, card.face, correct) : review
      if (shouldUpdatePracticeReview) {
        setReview(nextReview)
        saveReviewStore(nextReview)
      }
      if (next.mistakeSource === 'learning' || next.mistakeSource === 'all') {
        const learningCardIds = next.mistakeLearningCardIds ?? []
        if (learningCardIds.includes(card.card.cardId)) {
          const affectedDecks = Object.values(learningStore.cards).filter((memory) => memory.cardId === card.card.cardId).map((memory) => memory.deckId)
          let nextLearning = learningStore
          for (const deckId of affectedDecks) nextLearning = updateLearningMemory(nextLearning, deckId, card.card.cardId, correct)
          setLearningStore(nextLearning)
          saveLearningStore(nextLearning)
        }
      }
    }
    const now = Date.now()
    const beforeRecord = cardMemory[card.card.cardId]
    const nextCardMemory = updateCardMemory(cardMemory, card.card.cardId, card.face, correct, now, { abandoned, source })
    if (nextCardMemory !== cardMemory) {
      setCardMemory(nextCardMemory)
      saveCardMemoryStore(nextCardMemory)
    }
    const isReviewPractice = Boolean(next.reviewRun || (activeMode === 'practice' && !next.mistakeSource && !next.learningDeckId))
    if (next.reviewRun && source === 'due') {
      const order: CardMemoryQuality[] = ['bronze', 'silver', 'gold', 'mastered']
      const beforeQuality = beforeRecord?.quality
      const afterQuality = nextCardMemory[card.card.cardId]?.quality
      let upgraded = 0
      let downgraded = 0
      if (beforeQuality && afterQuality && beforeQuality !== afterQuality) {
        if (order.indexOf(afterQuality) > order.indexOf(beforeQuality)) upgraded = 1
        else downgraded = 1
      }
      const remaining = reviewRunRemaining - 1
      setReviewRunRemaining(remaining)
      setReviewRunStats((stats) => ({ reviewed: stats.reviewed + 1, upgraded: stats.upgraded + upgraded, downgraded: stats.downgraded + downgraded }))
      if (remaining <= 0) next.status = 'victory'
    }
    if (isReviewPractice) setReviewSession((session) => recordAnswer(session, card.card.cardId, correct))
    setBattle(next)
    setFeedback(correct
      ? { correct: true, text: source === 'requeue' ? '这次记住了，今晚再见。' : isPass ? '过牌答对，本题只计入复习记录，卡牌效果不生效。' : `${effectLabel(card.card.effectType)}牌生效：${effectDescription(card)}` }
      : { correct: false, abandoned, text: `${abandoned ? '已跳过本题。' : '回答错误。'} 正确答案：${card.card.word}。你受到 ${WRONG_DAMAGE} 点直接伤害。` })
  }

  function submitAnswer() {
    if (!question) return
    if (question.type === 'meaning') {
      if (!selectedOption) return
      completeAnswer(selectedOption === question.card.card.cardId)
    } else {
      completeAnswer(isSpellingCorrect(answer, question.card.card.word))
    }
  }

  function abandonSpelling() {
    if (question?.type === 'spelling') completeAnswer(false, true)
  }

  function closeFeedback() {
    if (!battle) return
    const next = structuredClone(battle) as BattleState
    if (next.player.hp <= 0) next.status = 'defeat'
    else if (canCompleteLearningDeck(next)) next.status = 'victory'
    else if (next.enemy.hp <= 0) {
      const advanced = advanceCampaignEnemy(next)
      if (advanced) Object.assign(next, advanced)
      else next.status = 'victory'
    }
    setBattle(next)
    setFeedback(null)
    setQuestion(null)
    setAnswer('')
    setSelectedOption(null)
    if (next.status !== 'playing') {
      setView('result')
      settleReviewSession()
    }
    if (next.status !== 'playing') activeMode === 'learning' && next.learningDeckId ? clearLearningBattleState(next.learningDeckId) : clearBattleState(activeMode)
  }

  function endTurn() {
    if (!battle || battle.status !== 'playing' || question || feedback) return
    const next = finishEnemyTurn(battle)
    if (next.status !== 'playing') {
      setBattle(next)
      settleReviewSession()
      activeMode === 'learning' && next.learningDeckId ? clearLearningBattleState(next.learningDeckId) : clearBattleState(activeMode)
      setView('result')
      return
    }
    let moreCards: CardRecord[]
    let drawnMeta: Array<{ source: CardSource; quality?: CardMemoryQuality }> = []
    let nextSession = reviewSession
    let moreIds: Set<string>
    if (next.reviewRun) {
      const result = dealHand([], next.drawPile, false, TURN_DRAW)
      moreCards = result.cards
      drawnMeta = result.meta
      nextSession = result.nextSession
      moreIds = result.deckIds
    } else if (activeMode === 'practice' && !next.mistakeSource) {
      const result = dealHand(next.drawPile, dueCardRecords(), true, TURN_DRAW)
      moreCards = result.cards
      drawnMeta = result.meta
      nextSession = result.nextSession
      moreIds = result.deckIds
    } else if (activeMode === 'learning' && next.learningDeckId) {
      moreCards = drawLearningCards(next.drawPile, learningStore, next.learningDeckId, next.learningPendingCounts ?? {}, next.learningLastIncorrectAt ?? {}, TURN_DRAW)
      moreIds = new Set(moreCards.map((item) => item.cardId))
    } else {
      moreCards = drawCards(next.drawPile, review, TURN_DRAW)
      moreIds = new Set(moreCards.map((item) => item.cardId))
    }
    next.drawPile = next.drawPile.filter((card) => !moreIds.has(card.cardId))
    const drawn = drawTurnCards(next, moreCards)
    if (next.reviewRun || (activeMode === 'practice' && !next.mistakeSource)) {
      setReviewSession(nextSession)
      setCardMeta((current) => {
        const meta: Record<string, { source: CardSource; quality?: CardMemoryQuality }> = { ...current }
        moreCards.forEach((card, index) => { meta[card.cardId] = drawnMeta[index] ?? { source: 'new' as CardSource } })
        return meta
      })
    }
    setBattle(drawn.state)
    if (drawn.state.status !== 'playing') {
      settleReviewSession()
      activeMode === 'learning' && drawn.state.learningDeckId ? clearLearningBattleState(drawn.state.learningDeckId) : clearBattleState(activeMode)
      setView('result')
    }
  }

  function resetProgress() {
    setReview({})
    saveReviewStore({})
  }

  function openMistakes(page: MistakeBookPage = 'choose') {
    setQuestion(null)
    setFeedback(null)
    setView('mistakes')
    setMistakeBookPage(page)
  }

  function startMistakePractice(source: 'practice' | 'learning' | 'all', maxCount?: number) {
    const practiceIds = source === 'learning' ? [] : getReviewMistakes(review).map((record) => record.cardId)
    const learningIds = source === 'practice' ? [] : [...new Set(getLearningMistakes(learningStore).map((memory) => memory.cardId))]
    const ids = source === 'practice' ? practiceIds : source === 'learning' ? learningIds : [...new Set([...practiceIds, ...learningIds])]
    if (!isValidMistakePracticeCount(ids.length, maxCount)) return
    openCampaignSetup({ mode: 'mistakes', mistakeSource: source, mistakeMaxCount: maxCount })
  }

  function resetLearningDeck(deckId: string) {
    if (window.confirm('确定清除这个卡组的学习记忆吗？该操作不会影响练习记录。')) {
      deleteLearningMemory(deckId)
      deleteLearningBattle(deckId)
    }
  }

  if (loading) return <main className="app-shell centered"><div className="loading-mark"><Swords size={28} /><p>正在整理词卡牌库…</p></div></main>
  if (error) return <main className="app-shell centered"><div className="error-panel"><CircleHelp size={30} /><h1>词卡载入失败</h1><p>{error}</p><button className="button primary" onClick={() => window.location.reload()}><RotateCcw size={16} />重新载入</button></div></main>

  return <main className="app-shell">
    <header className="topbar">
      <button className="brand" onClick={() => setView('menu')} aria-label="返回首页"><span className="brand-mark"><Swords size={20} /></span><span><strong>LEXICON DUEL</strong><small>CET-6 WORD BATTLE</small></span></button>
      <div className="topbar-actions"><span className="library-count"><BookOpen size={15} /> {library.length.toLocaleString()} 张词卡</span><button className={`nav-button ${view === 'stats' ? 'active' : ''}`} onClick={() => setView('stats')} aria-label="学习统计"><BarChart3 size={16} /><span className="nav-label">学习统计</span></button><button className={`nav-button ${view === 'accounts' ? 'active' : ''}`} onClick={openAccounts} aria-label={`账号：${accountRegistry.activeUsername}`}><UserRound size={16} /><span className="topbar-username">{accountRegistry.activeUsername}</span></button></div>
    </header>
    {view === 'menu' && <Menu stats={stats} librarySize={library.length} onStart={openModeSelect} onStats={() => setView('stats')} onLibrary={() => setView('library')} onMistakes={openMistakes} />}
    {view === 'modes' && <ModeSelect battleStore={battleStore} onLearning={openLearningDecks} onPractice={startPractice} onContinue={continueBattle} onDelete={deleteSavedBattle} onBack={() => setView('menu')} />}
    {view === 'learning-decks' && <LearningDecks decks={studyDecks} learning={learningStore} battleStore={battleStore} onStart={startLearning} onContinue={continueLearning} onDeleteBattle={deleteLearningBattle} onReset={resetLearningDeck} onBack={() => setView('modes')} />}
    {view === 'campaign-setup' && campaignStart && campaignConfig && characterConfig && <CampaignSetup start={campaignStart} config={campaignConfig} characters={characterConfig} decks={studyDecks} onSelectCharacter={() => setView('character-select')} onStart={(route, characterId) => startCampaign(campaignStart, route, characterId)} onBack={() => setView(campaignStart.mode === 'learning' ? 'learning-decks' : campaignStart.mode === 'mistakes' ? 'mistakes' : 'modes')} />}
    {view === 'character-select' && campaignStart && characterConfig && <CharacterSelect characterConfig={characterConfig} selectedCharacterId={campaignStart.characterId} onSelect={(characterId) => { setCampaignStart({ ...campaignStart, characterId }); setView('campaign-setup') }} onBack={() => setView('campaign-setup')} />}
    {view === 'stats' && <Stats review={review} learning={learningStore} library={library} stats={stats} onReset={resetProgress} onMistakes={() => openMistakes('all')} onBack={() => setView('menu')} />}
    {view === 'library' && <LibraryPage library={library} review={review} onBack={() => setView('menu')} />}
    {view === 'mistakes' && <MistakeBook review={review} learning={learningStore} cardMemory={cardMemory} library={library} initialPage={mistakeBookPage} onReview={startReviewRun} onPractice={(maxCount) => startMistakePractice('practice', maxCount)} onLearning={(maxCount) => startMistakePractice('learning', maxCount)} onAll={(maxCount) => startMistakePractice('all', maxCount)} onBack={() => setView('menu')} />}
    {view === 'battle' && battle && <BattleScreen battle={battle} question={question} answer={answer} setAnswer={setAnswer} selectedOption={selectedOption} setSelectedOption={setSelectedOption} cardMeta={cardMeta} onCard={beginQuestion} onSubmit={submitAnswer} onAbandon={abandonSpelling} feedback={feedback} onCloseFeedback={closeFeedback} onEndTurn={endTurn} onExitBattle={exitBattle} onAbility={(abilityId) => { const result = useCharacterAbility(battle, abilityId); if (!result) return; setBattle(result.state); setFeedback({ correct: true, text: result.summary }) }} />}
    {view === 'result' && battle && <Result battle={battle} library={library} reviewRunStats={reviewRunStats} onAgain={() => battle.mode === 'learning' ? openLearningDecks() : battle.reviewRun || battle.mistakeSource ? openMistakes() : openModeSelect()} onHome={() => setView('menu')} onStats={() => setView('stats')} />}
    {view === 'accounts' && <AccountsPage registry={accountRegistry} onCreate={createUserAccount} onSwitch={switchUserAccount} onDelete={removeUserAccount} onExport={exportUserAccount} onImport={importUserAccount} onBack={() => setView('menu')} />}
  </main>
}

function Menu({ stats, librarySize, onStart, onStats, onLibrary, onMistakes }: { stats: ReturnType<typeof allReviewStats>; librarySize: number; onStart: () => void; onStats: () => void; onLibrary: () => void; onMistakes: () => void }) {
  return <section className="menu-page"><div className="menu-copy"><div className="eyebrow"><span className="eyebrow-dot" /> WORDS BECOME WEAPONS</div><h1>把词汇<br /><em>打进记忆。</em></h1><p>每一次出牌，都是一次主动回忆。用 CET-6 词汇构筑你的战斗节奏。</p><div className="menu-actions"><div className="menu-action-column"><button className="button primary large" onClick={onStart}><Swords size={18} />开始战斗<ChevronRight size={18} /></button><button className="button ghost large" onClick={onMistakes}><Target size={17} />错题本</button></div><div className="menu-action-column"><button className="button ghost large" onClick={onLibrary}><BookOpen size={17} />查看所有单词</button><button className="button ghost large" onClick={onStats}><BarChart3 size={17} />查看学习统计</button></div></div></div><div className="menu-visual"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="hero-card hero-card-back" /><div className="hero-card hero-card-main"><div className="hero-card-top"><span>WORD CARD</span><span className="rarity">LV. 4</span></div><div className="hero-word">resilient</div><div className="hero-phonetic">/rɪˈzɪliənt/</div><div className="hero-meaning">adj. 有弹性的；能迅速恢复的</div><div className="hero-card-bottom"><span>强化</span><span><Sparkles size={14} /> +4</span></div></div><div className="floating-note note-one"><Target size={15} /><span><strong>{stats.correct}</strong><small>次正确回忆</small></span></div><div className="floating-note note-two"><Zap size={15} /><span><strong>{librarySize.toLocaleString()}</strong><small>张词汇卡</small></span></div></div><div className="feature-strip"><div><span>01</span><strong>主动回忆</strong><small>答对才有资格出牌</small></div><div><span>02</span><strong>策略战斗</strong><small>词性决定你的招式</small></div><div><span>03</span><strong>持续复习</strong><small>错题会再次回来</small></div></div></section>
}

function CampaignSetup({ start, config, characters, decks, onSelectCharacter, onStart, onBack }: { start: CampaignStart; config: CampaignConfig; characters: CharacterConfig; decks: StudyDeck[]; onSelectCharacter: () => void; onStart: (route: CampaignRoute, characterId: string) => void; onBack: () => void }) {
  const characterId = start.characterId ?? characters.characters[0]?.id ?? ''
  const mode = start.mode === 'practice' ? 'practice' : 'learning'
  const enemyCount = config[mode].sets.reduce((sum, set) => sum + set.enemies.length, 0)
  const deck = start.deckId ? decks.find((item) => item.deckId === start.deckId) : undefined
  const title = start.mode === 'learning' ? `学习战役 · ${deck?.title ?? '所选卡组'}` : start.mode === 'mistakes' ? '错题战役' : '练习战役'
  const character = characters.characters.find((item) => item.id === characterId) ?? characters.characters[0]
  return <section className="campaign-page"><button className="back-link" onClick={onBack}>← 返回上一步</button><div className="eyebrow"><span className="eyebrow-dot" /> CAMPAIGN ROUTE</div><h1>{title}</h1><p className="mode-lead">先确定角色，再选择本次连续战斗的敌人路线。中途退出可以从当前敌人继续。</p><button className="selected-character" onClick={onSelectCharacter}><span className="mode-icon"><Portrait avatar={character?.avatar} icon={character?.icon ?? 'shield'} size={25} /></span><span><small>当前角色</small><strong>{character?.name ?? '未选择'}</strong><em>{character?.subtitle ?? '请选择一个角色'} · {character?.maxHp ?? 0} 最大生命</em></span><ChevronRight size={18} /></button><div className="campaign-routes"><button className="campaign-route" disabled={!characterId} onClick={() => onStart('set', characterId)}><span className="mode-icon"><Crown size={22} /></span><span><strong>随机敌人组</strong><small>随机选择一套预设路线，按配置顺序挑战到最终敌人。</small></span><ChevronRight size={18} /></button><button className="campaign-route" disabled={!characterId} onClick={() => onStart('all', characterId)}><span className="mode-icon"><Swords size={22} /></span><span><strong>随机 5 名敌人</strong><small>从当前模式的 {enemyCount} 名敌人中随机选择最多 5 名。</small></span><ChevronRight size={18} /></button></div></section>
}

function CharacterSelect({ characterConfig, selectedCharacterId, onSelect, onBack }: { characterConfig: CharacterConfig; selectedCharacterId?: string; onSelect: (characterId: string) => void; onBack: () => void }) {
  const [query, setQuery] = useState('')
  const normalizedQuery = query.trim().toLowerCase()
  const characters = characterConfig.characters.filter((character) => !normalizedQuery || [character.name, character.alias ?? '', character.subtitle].some((value) => value.toLowerCase().includes(normalizedQuery)))
  return <section className="character-select-page"><button className="back-link" onClick={onBack}>← 返回路线选择</button><div className="eyebrow"><span className="eyebrow-dot" /> PLAYER CHARACTERS</div><h1>选择己方角色</h1><p className="mode-lead">每个角色独立配置，后续可以继续扩展角色数量。</p><label className="character-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索角色名称或别名" aria-label="搜索角色" /></label><div className="character-select-grid">{characters.map((character) => <button key={character.id} className={`character-select-option ${character.id === selectedCharacterId ? 'active' : ''}`} onClick={() => onSelect(character.id)}><span className="character-select-icon"><Portrait avatar={character.avatar} icon={character.icon} size={30} /></span><span><strong>{character.name}</strong><small>{character.alias ? `${character.alias} · ` : ''}{character.subtitle}</small><em>{character.maxHp} 最大生命 · {Math.min(MAX_SHIELD, character.shield ?? 0)} 初始护盾</em></span><ChevronRight size={17} /></button>)}</div>{characters.length === 0 && <div className="stats-empty"><Search size={18} />没有找到符合条件的角色。</div>}</section>
}

function MistakeBook({ review, learning, cardMemory, library, initialPage, onReview, onPractice, onLearning, onAll, onBack }: { review: ReviewStore; learning: LearningStore; cardMemory: ReturnType<typeof loadCardMemoryStore>; library: CardRecord[]; initialPage: MistakeBookPage; onReview: () => void; onPractice: (maxCount?: number) => void; onLearning: (maxCount?: number) => void; onAll: (maxCount?: number) => void; onBack: () => void }) {
  const [page, setPage] = useState<MistakeBookPage>(initialPage)
  const [maxCount, setMaxCount] = useState('')
  const practice = getReviewMistakes(review)
  const study = getLearningMistakes(learning)
  const practiceIds = new Set(practice.map((record) => record.cardId))
  const studyIds = new Set(study.map((memory) => memory.cardId))
  const requestedCount = maxCount.trim() === '' ? undefined : Number(maxCount)
  const practiceLimit = requestedCount === undefined ? undefined : requestedCount
  const allCount = new Set([...practiceIds, ...studyIds]).size
  const validPractice = isValidMistakePracticeCount(practiceIds.size, requestedCount)
  const validLearning = isValidMistakePracticeCount(studyIds.size, requestedCount)
  const validAll = isValidMistakePracticeCount(allCount, requestedCount)
  const memorySummary = getCardMemorySummary(cardMemory)
  const nextDueAt = getNextDueAt(cardMemory)
  const cardFor = (id: string) => library.find((card) => card.cardId === id)
  const renderWords = (ids: string[]) => <div className="mistake-book-list">{ids.map((id) => { const card = cardFor(id); return card ? <div className="mistake-book-row" key={id}><strong>{card.word}</strong><span>{card.pos}</span><em>{card.meaning}</em><button className="speech-button mistake-speech-button" aria-label={`播放 ${card.word} 的发音`} onClick={() => speakWord(card.word, card.pos)}><Volume2 size={15} /></button></div> : null })}</div>
  const renderMemoryRecords = () => <div className="memory-record-list">{Object.values(cardMemory).map((record) => { const card = cardFor(record.cardId); return <article className={`memory-record quality-${record.quality}`} key={record.cardId}><div className="memory-record-main"><div><strong>{card?.word ?? record.cardId}</strong><span className={`quality-badge quality-${record.quality}`}>{({ bronze: '青铜', silver: '白银', gold: '黄金', mastered: '已掌握' } as const)[record.quality]}</span><small>{card ? `${card.pos} · ${card.meaning}` : '词库中暂无此卡片'}</small></div>{card && <button className="speech-button mistake-speech-button" aria-label={`播放 ${card.word} 的发音`} onClick={() => speakWord(card.word, card.pos)}><Volume2 size={15} /></button>}</div><div className="memory-record-meta"><span>连对 {record.streak}</span><span>错误 {record.lapses}</span><span className={record.dueAt <= Date.now() ? 'is-due' : ''}>{record.dueAt <= Date.now() ? '已到期' : `下次：${new Date(record.dueAt).toLocaleDateString()}`}</span></div></article> })}{Object.keys(cardMemory).length === 0 && <div className="stats-empty"><Check size={18} />暂无复习卡片，答错的单词会出现在这里。</div>}</div>
  return <section className="mistake-book-page"><button className="back-link" onClick={onBack}>← 返回首页</button><div className="mistake-book-heading"><div><div className="eyebrow"><span className="eyebrow-dot" /> MISTAKE BOOK</div><h1>错题本</h1><p>把答错的词重新带回战场，连续答对三次后自动移除。</p></div><div className="mistake-book-review"><button className="button primary" disabled={memorySummary.due === 0} onClick={onReview}><RotateCcw size={15} />开始复习（{memorySummary.due}）</button><small>本局取最早到期的 20 张</small></div><div className="mistake-book-total"><strong>{allCount}</strong><span>个待复习词</span></div></div><div className="mistake-book-tabs"><button className={page === 'choose' ? 'active' : ''} onClick={() => setPage('choose')}>选择练习</button><button className={page === 'all' ? 'active' : ''} onClick={() => setPage('all')}>查看所有错题</button><button className="active" onClick={() => setPage('all')}>记忆档案 {memorySummary.total}</button></div>{page === 'choose' ? <><div className="mistake-limit-control"><label htmlFor="mistake-limit">本次最多练习</label><input id="mistake-limit" type="number" min="10" step="1" inputMode="numeric" value={maxCount} onChange={(event) => setMaxCount(event.target.value)} placeholder="全部" /><span>个错词，最少 10 个</span></div>{requestedCount !== undefined && !Number.isInteger(requestedCount) || requestedCount !== undefined && requestedCount < 10 ? <p className="mistake-limit-error">请输入不小于 10 的整数。</p> : null}<div className="mistake-choice-grid"><article><div className="choice-icon"><Crosshair size={22} /></div><strong>练习模式错题</strong><p>{practiceIds.size} 个词 · 使用练习战斗规则</p><button className="button primary" disabled={!validPractice} onClick={() => onPractice(practiceLimit)}><Swords size={15} />开始练习</button></article><article><div className="choice-icon"><BookOpen size={22} /></div><strong>学习模式错题</strong><p>{studyIds.size} 个词 · 按学习记录追踪</p><button className="button primary" disabled={!validLearning} onClick={() => onLearning(practiceLimit)}><BookOpen size={15} />开始学习错题</button></article><article><div className="choice-icon"><Target size={22} /></div><strong>全部错题</strong><p>{allCount} 个词 · 合并两类错题</p><button className="button ghost" disabled={!validAll} onClick={() => onAll(practiceLimit)}><RotateCcw size={15} />混合练习</button></article></div></> : <><div className="memory-summary"><span>总档案 <strong>{memorySummary.total}</strong></span><span>已到期 <strong>{memorySummary.due}</strong></span><span>累计错误 <strong>{memorySummary.lapses}</strong></span></div>{memorySummary.total > 0 && memorySummary.due === 0 && <p className="review-next-due">下次到期：{nextDueAt ? new Date(nextDueAt).toLocaleString() : '—'}</p>}{renderMemoryRecords()}</>}</section>
}

function ModeSelect({ battleStore, onLearning, onPractice, onContinue, onDelete, onBack }: { battleStore: BattleStore; onLearning: () => void; onPractice: () => void; onContinue: (mode: BattleMode) => void; onDelete: (mode: BattleMode) => void; onBack: () => void }) {
  const savedPractice = battleStore.practice?.status === 'playing'
  return <section className="mode-page"><button className="back-link" onClick={onBack}>← 返回首页</button><div className="eyebrow"><span className="eyebrow-dot" /> SELECT ENCOUNTER MODE</div><h1>选择战斗模式</h1><p className="mode-lead">选择一条适合此刻复习节奏的路径。</p><div className="mode-list"><button className="mode-option is-open" onClick={onLearning}><span className="mode-number">01</span><span className="mode-icon"><BookOpen size={22} /></span><span className="mode-copy"><strong>学习</strong><small>按卡组和学习进度安排词卡</small></span><span className="mode-status">选择卡组<ChevronRight size={17} /></span></button><div className="mode-group"><button className="mode-option is-open" onClick={onPractice}><span className="mode-number">02</span><span className="mode-icon"><Crosshair size={22} /></span><span className="mode-copy"><strong>练习</strong><small>从全部题库随机抽取词卡</small></span><span className="mode-status">开始新对局<ChevronRight size={17} /></span></button>{savedPractice && <div className="saved-battle"><span><RotateCcw size={15} /><strong>有一局练习残局</strong><small>第 {battleStore.practice?.turn} 回合 · {battleStore.practice?.player.hp} 生命</small></span><div className="save-actions"><button className="button primary" onClick={() => onContinue('practice')}><RotateCcw size={14} />继续</button><button className="button delete-battle" onClick={() => onDelete('practice')} aria-label="删除练习残局"><Trash2 size={15} />删除</button></div></div>}</div><button className="mode-option is-locked" disabled><span className="mode-number">03</span><span className="mode-icon"><Zap size={22} /></span><span className="mode-copy"><strong>联机</strong><small>与其他词汇行者进行对战</small></span><span className="mode-status">即将开放</span></button></div></section>
}

function LearningDecks({ decks, learning, battleStore, onStart, onContinue, onDeleteBattle, onReset, onBack }: { decks: StudyDeck[]; learning: LearningStore; battleStore: BattleStore; onStart: (deck: StudyDeck) => void; onContinue: (deckId: string) => void; onDeleteBattle: (deckId: string) => void; onReset: (deckId: string) => void; onBack: () => void }) {
  const defaultDeck = getDefaultDeck(decks, learning)
  const today = getTodayLearnedCount(learning)
  const groups: Array<[string, StudyDeck[]]> = [['高频卡组', decks.filter((deck) => deck.category === 'standard')], ['低频卡组', decks.filter((deck) => deck.category === 'low-frequency')], ['特定主题', decks.filter((deck) => deck.category === 'topic')]]
  const sectionIds = { standard: 'study-standard', low: 'study-low-frequency', topic: 'study-topics' }
  return <section className="deck-page"><button className="back-link" onClick={onBack}>← 返回模式选择</button><div className="deck-heading"><div><div className="eyebrow"><span className="eyebrow-dot" /> STUDY DECKS</div><h1>选择学习卡组</h1><p>答对卡片才会记入本组进度，已完成的卡组也可以再次学习。</p></div><div className="today-study"><strong>{today}</strong><span>今天学了多少张卡</span></div></div><nav className="deck-directory" aria-label="学习卡组目录">{groups.map(([label, items]) => { const id = items[0]?.category === 'standard' ? sectionIds.standard : items[0]?.category === 'low-frequency' ? sectionIds.low : sectionIds.topic; return <button key={id} onClick={() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>{label}<small>{items.length}</small></button> })}</nav>{defaultDeck && <div className="recommended-deck"><div><span className="section-label">建议下一组</span><strong>{defaultDeck.title}</strong><small>{getDeckProgress(defaultDeck, learning).mastered} / {defaultDeck.totalCards} 张已掌握</small></div><button className="button primary" onClick={() => onStart(defaultDeck)}><BookOpen size={16} />{learning.decks[defaultDeck.deckId] ? '继续学习' : '开始学习'}</button></div>}{groups.map(([label, items]) => { const id = items[0]?.category === 'standard' ? sectionIds.standard : items[0]?.category === 'low-frequency' ? sectionIds.low : sectionIds.topic; return <div className="deck-section" id={id} key={label}><div className="deck-section-heading"><span className="section-label">{label}</span><small>{items.length} 组</small></div><div className="deck-grid">{items.map((deck) => { const progress = getDeckProgress(deck, learning); const saved = Boolean(battleStore.learning?.[deck.deckId]?.status === 'playing'); const hasProgress = Boolean(learning.decks[deck.deckId]); return <article className="deck-card" key={deck.deckId}><div className="deck-card-top"><span className="level-dot level-3">{deck.totalCards}</span><span>{deck.category === 'topic' ? '主题' : '30张一组'}</span></div><h2>{deck.title}</h2><p>{deck.description}</p><div className="deck-progress-line"><span>{progress.mastered} / {progress.total} 已掌握</span><strong>{progress.percent}%</strong></div><ProgressBar value={progress.mastered} max={progress.total} tone="green" /><div className="subgroup-progress">{deck.subgroups.map((part) => { const mastered = part.cardIds.filter((id) => learning.decks[deck.deckId]?.masteredCardIds.includes(id)).length; return <span key={part.subgroupId} title={`${part.title} ${mastered}/${part.cardIds.length}`} className={mastered === part.cardIds.length ? 'done' : ''}>{mastered}</span> })}</div><div className="deck-actions">{(saved || hasProgress) ? <button className="button primary" onClick={() => onContinue(deck.deckId)}>{saved ? <RotateCcw size={14} /> : <BookOpen size={14} />}继续学习</button> : <button className="button primary" onClick={() => onStart(deck)}><BookOpen size={14} />开始学习</button>}{progress.mastered === progress.total && !saved && <button className="icon-text-button" onClick={() => onStart(deck)}><RotateCcw size={14} />再次学习</button>}<button className="icon-text-button" onClick={() => onReset(deck.deckId)}><Trash2 size={14} />清除记忆</button>{saved && <button className="icon-text-button danger-text" onClick={() => onDeleteBattle(deck.deckId)}><X size={14} />删除残局</button>}</div></article> })}</div></div> })}</section>
}

function BattleScreen({ battle, question, answer, setAnswer, selectedOption, setSelectedOption, cardMeta, onCard, onSubmit, onAbandon, feedback, onCloseFeedback, onEndTurn, onExitBattle, onAbility }: { battle: BattleState; question: QuestionState | null; answer: string; setAnswer: (value: string) => void; selectedOption: string | null; setSelectedOption: (value: string | null) => void; cardMeta: Record<string, { source: CardSource; quality?: CardMemoryQuality }>; onCard: (card: RuntimeCard) => void; onSubmit: () => void; onAbandon: () => void; feedback: { correct: boolean; text: string; abandoned?: boolean } | null; onCloseFeedback: () => void; onEndTurn: () => void; onExitBattle: () => void; onAbility: (abilityId: string) => void }) {
  const progress = campaignEnemyProgress(battle)
  const passiveAbilities = battle.character.abilities.filter((ability) => ability.kind === 'passive')
  const activeAbilities = activeCharacterAbilities(battle)
  return <section className="battle-page"><div className="battle-head"><div><div className="eyebrow"><span className="eyebrow-dot" /> CONTINUOUS CAMPAIGN</div><h1>{battle.enemy.subtitle} · 连续战役</h1>{progress && <div className="campaign-progress">敌人 {progress.current} / {progress.total}</div>}</div><div className="battle-actions"><div className="turn-display"><small>回合</small><strong>{String(battle.turn).padStart(2, '0')}</strong></div><button className="button end-turn" disabled={Boolean(question || feedback)} onClick={onEndTurn}>{battle.player.energy > 0 ? '结束回合' : '结束过牌'}<ChevronRight size={17} /></button><button className="button exit-battle" onClick={onExitBattle}><LogOut size={16} />退出战斗</button></div></div><div className="arena"><div className="enemy-side"><div className="enemy-label"><span className="status-dot danger" /> HOSTILE ENTITY <span>{progress ? String(progress.current).padStart(2, '0') : '01'}</span></div><div className="enemy-portrait"><div className="enemy-core"><Portrait avatar={battle.enemy.avatar} icon={battle.enemy.icon} size={50} /></div><div className="enemy-ring ring-a" /><div className="enemy-ring ring-b" /></div><div className="enemy-name">{battle.enemy.name}</div><div className="enemy-subtitle">{battle.enemy.subtitle}</div><div className="bar-line"><span>生命值</span><strong>{battle.enemy.hp} / {battle.enemy.maxHp}</strong></div><ProgressBar value={battle.enemy.hp} max={battle.enemy.maxHp} tone="red" /><div className="stat-row enemy-shield"><span><Shield size={15} />护盾</span><strong>{battle.enemy.shield}</strong></div><ProgressBar value={battle.enemy.shield} max={MAX_SHIELD} tone="blue" /><div className="enemy-abilities">{battle.enemy.abilities.length > 0 ? battle.enemy.abilities.map((ability, index) => <span key={`${ability.type}-${index}`}><Zap size={13} />{ability.description}</span>) : <span><CircleHelp size={13} />暂无特殊能力</span>}</div><div className="enemy-intent"><Crosshair size={15} /><span>下回合攻击</span><strong>{enemyAttack(battle)} <small>DAMAGE</small></strong></div></div><div className="arena-divider"><span>VS</span></div><div className="player-side"><div className="player-label"><span>PLAYER</span><span className="status-dot safe" /> YOU</div><div className="player-seal"><Portrait avatar={battle.character.avatar} icon={battle.character.icon} size={32} /></div><div className="player-name">{battle.character.name}</div><div className="player-subtitle">{battle.character.subtitle}</div><div className="stat-row"><span><Heart size={15} />生命</span><strong>{battle.player.hp} <small>/ {battle.player.maxHp}</small></strong></div><ProgressBar value={battle.player.hp} max={battle.player.maxHp} tone="green" /><div className="stat-row"><span><Shield size={15} />护盾</span><strong>{battle.player.shield}</strong></div><ProgressBar value={battle.player.shield} max={MAX_SHIELD} tone="blue" /><div className="character-panel"><div className="character-panel-title"><span>角色能力</span><small>主动技能不消耗行动力</small></div>{passiveAbilities.length > 0 && <div className="character-abilities passive-abilities">{passiveAbilities.map((ability) => <span key={ability.id}><Sparkles size={13} />{ability.description}</span>)}</div>}{activeAbilities.length > 0 && <div className="character-abilities active-abilities">{activeAbilities.map((ability) => { const cooldown = battle.character.cooldowns[ability.id] ?? 0; const available = cooldown === 0 && !question && !feedback; return <button className="character-ability" key={ability.id} disabled={!available} onClick={() => onAbility(ability.id)}><span><Zap size={14} /><strong>{ability.description}</strong></span><small>{cooldown > 0 ? `冷却 ${cooldown} 回合` : '可用 · 不消耗行动力'}</small></button> })}</div>}{passiveAbilities.length === 0 && activeAbilities.length === 0 && <span className="character-no-abilities">暂无特殊能力</span>}</div></div></div><div className="battle-bottom"><div className="hand-heading"><div><span className="eyebrow"><span className="eyebrow-dot" /> YOUR HAND</span><strong>{battle.hand.length} / {MAX_HAND}</strong></div><div className={`energy ${battle.player.energy === 0 ? 'is-pass' : ''}`}><Zap size={17} fill="currentColor" /><strong>{battle.player.energy}</strong><span>{battle.player.energy > 0 ? '/ 3 ACTION' : '过牌阶段'}</span></div></div><div className="hand">{battle.hand.length === 0 ? <div className="empty-hand">手牌已打空。点击上方“结束回合”抽取新牌。</div> : battle.hand.map((card) => <CardView key={card.instanceId} card={card} source={cardMeta[card.card.cardId]?.source} quality={cardMeta[card.card.cardId]?.quality} disabled={Boolean(question || feedback)} showSpeech={!question || question.type === 'meaning'} onClick={() => onCard(card)} />)}</div><div className="battle-footer"><div className="battle-log">{battle.log[0]}</div></div></div>{question && !feedback && <QuestionModal question={question} answer={answer} setAnswer={setAnswer} selectedOption={selectedOption} setSelectedOption={setSelectedOption} onSubmit={onSubmit} onAbandon={onAbandon} />}{feedback && <FeedbackModal feedback={feedback} question={question} onClose={onCloseFeedback} />}</section>
}

export function CardView({ card, disabled, showSpeech = true, source, quality, onClick }: { card: RuntimeCard; disabled: boolean; showSpeech?: boolean; source?: CardSource; quality?: CardMemoryQuality; onClick: () => void }) {
  const badge = source === 'due' ? '复习' : source === 'requeue' ? '重现' : null
  const wrapClass = `game-card-wrap effect-${card.card.effectType} face-${card.face}${source ? ` source-${source}` : ''}${quality ? ` quality-${quality}` : ''}`
  return <div className={wrapClass}>{badge && <span className={`review-badge source-${source}`}>{badge}</span>}<button className="game-card" disabled={disabled} onClick={onClick}><span className="card-level">LV.{card.card.frequencyLevel}</span><span className="card-face-label">{card.face === 'meaning' ? '识义题' : '拼写题'} · {effectLabel(card.card.effectType)}</span><span className="card-glyph"><IconForEffect type={card.card.effectType} /></span><strong>{card.face === 'meaning' ? card.card.word : card.card.meaning}</strong><small>{card.card.pos}</small><span className="card-effect">{effectDescription(card)}</span></button>{showSpeech && card.face === 'meaning' && <button className="speech-button card-speech-button" aria-label={`播放 ${card.card.word} 的发音`} onClick={(event) => { event.stopPropagation(); speakWord(card.card.word, card.card.pos) }}><Volume2 size={15} /></button>}</div>
}

export function QuestionModal({ question, answer, setAnswer, selectedOption, setSelectedOption, onSubmit, onAbandon }: { question: QuestionState; answer: string; setAnswer: (value: string) => void; selectedOption: string | null; setSelectedOption: (value: string | null) => void; onSubmit: () => void; onAbandon: () => void }) {
  const card = question.card.card
  return <div className="modal-backdrop"><div className="question-modal"><div className="modal-kicker"><span>{question.type === 'meaning' ? 'MEANING CHECK' : 'SPELLING CHECK'}</span><span>LV.{card.frequencyLevel} · {card.frequencyLabel}</span></div>{question.type === 'meaning' ? <><div className="question-word-line"><h2>{card.word}</h2><button className="speech-button" aria-label={`播放 ${card.word} 的发音`} onClick={() => speakWord(card.word, card.pos)}><Volume2 size={18} /></button></div><p className="phonetic">{card.phonetic || '/ pronunciation /'} <span>{card.pos}</span></p><p className="question-prompt">选择最符合的中文释义</p><div className="options">{question.options.map((option, index) => <button className={`option ${selectedOption === option.cardId ? 'selected' : ''}`} key={`${option.cardId}-${index}`} onClick={() => setSelectedOption(option.cardId)}><span>{String.fromCharCode(65 + index)}</span><strong>{option.pos}</strong><em>{option.meaning}</em></button>)}</div></> : <><h2 className="chinese-prompt">{card.meaning}</h2><p className="question-prompt">从首字母开始拼写对应的英文单词</p><p className="first-letter-hint">首字母提示：<strong>{card.word[0].toUpperCase()}</strong></p><div className="spelling-box"><div className="letter-slots">{Array.from({ length: card.word.length }, (_, index) => <span key={index}>{answer[index] || '_'}</span>)}</div><input autoFocus value={answer} maxLength={card.word.length} onChange={(event) => { const next = event.target.value.replace(/[^a-zA-Z]/g, ''); if (!next || next[0].toLowerCase() === card.word[0].toLowerCase()) setAnswer(next) }} onKeyDown={(event) => { if (event.key === 'Enter') onSubmit() }} placeholder="输入完整单词" /></div></>}<div className="answer-actions"><button className="button primary submit-answer" disabled={question.type === 'meaning' ? !selectedOption : answer.length !== card.word.length} onClick={onSubmit}><Check size={17} />提交答案</button>{question.type === 'spelling' && <button className="button give-up" onClick={onAbandon}>放弃本题</button>}</div><p className="modal-hint">答错或放弃会受到 {WRONG_DAMAGE} 点直接伤害</p></div></div>
}

function FeedbackModal({ feedback, question, onClose }: { feedback: { correct: boolean; text: string; abandoned?: boolean }; question: QuestionState | null; onClose: () => void }) {
  return <div className="modal-backdrop"><div className={`feedback-modal ${feedback.correct ? 'is-correct' : 'is-wrong'}`}><div className="feedback-icon">{feedback.correct ? <Check size={30} /> : <CircleHelp size={30} />}</div><span className="feedback-label">{feedback.correct ? 'ANSWER CONFIRMED' : feedback.abandoned ? 'QUESTION SKIPPED' : 'RECALL MISSED'}</span><h2>{feedback.correct ? '答对了' : feedback.abandoned ? '已放弃本题' : '这次没记住'}</h2><p>{feedback.text}</p>{question && <div className="answer-reveal"><div className="answer-word-line"><span>{question.card.card.word}</span><button className="speech-button" aria-label={`播放 ${question.card.card.word} 的发音`} onClick={() => speakWord(question.card.card.word, question.card.card.pos)}><Volume2 size={16} /></button></div><small>{question.card.card.pos} · {question.card.card.meaning}</small></div>}<button className="button primary" onClick={onClose}>继续战斗<ChevronRight size={17} /></button></div></div>
}

function Result({ battle, library, reviewRunStats, onAgain, onHome, onStats }: { battle: BattleState; library: CardRecord[]; reviewRunStats: { reviewed: number; upgraded: number; downgraded: number }; onAgain: () => void; onHome: () => void; onStats: () => void }) {
  const victory = battle.status === 'victory'
  const errors = battle.errorCardIds.map((id) => library.find((card) => card.cardId === id)).filter(Boolean) as CardRecord[]
  if (battle.reviewRun) {
    return <section className="result-page"><div className={`result-icon ${victory ? 'victory' : 'defeat'}`}>{victory ? <RotateCcw size={38} /> : <CircleHelp size={38} />}</div><div className="eyebrow centered-text"><span className="eyebrow-dot" /> REVIEW COMPLETE</div><h1>复习结束</h1><p className="result-lead">本轮到期卡片复习完成。</p><div className="result-stats"><div><strong>{reviewRunStats.reviewed}</strong><span>复习张数</span></div><div><strong>{reviewRunStats.upgraded}</strong><span>升级</span></div><div><strong>{reviewRunStats.downgraded}</strong><span>跌落</span></div><div><strong>{percent(battle.correctAnswers, battle.totalAnswers)}</strong><span>正确率</span></div></div>{errors.length > 0 && <div className="error-words"><div className="section-label">需要再见一面 <span>{errors.length}</span></div><div className="error-list">{errors.slice(0, 6).map((card) => <span key={card.cardId}>{card.word}<small>{card.pos}</small></span>)}</div></div>}<div className="result-actions"><button className="button primary large" onClick={onAgain}><RotateCcw size={17} />返回错题本</button><button className="button ghost large" onClick={onStats}><BarChart3 size={17} />学习统计</button><button className="text-button" onClick={onHome}>返回首页</button></div></section>
  }
  return <section className="result-page"><div className={`result-icon ${victory ? 'victory' : 'defeat'}`}>{victory ? <Swords size={38} /> : <CircleHelp size={38} />}</div><div className="eyebrow centered-text"><span className="eyebrow-dot" /> {victory ? 'ENCOUNTER CLEARED' : 'ENCOUNTER ENDED'}</div><h1>{victory ? '记忆，赢下一局。' : '遗忘暂时占了上风。'}</h1><p className="result-lead">{victory ? '你把词汇变成了行动。保持这个节奏，下一轮会更稳。' : '每一个错误都是下一次复习的入口。把它们再看一遍，然后重新挑战。'}</p><div className="result-stats"><div><strong>{percent(battle.correctAnswers, battle.totalAnswers)}</strong><span>总体正确率</span></div><div><strong>{battle.usedCards}</strong><span>使用卡牌</span></div><div><strong>{battle.turn}</strong><span>坚持回合</span></div><div><strong>{battle.faceStats.spelling.correct}/{battle.faceStats.spelling.total}</strong><span>拼写正确</span></div></div>{errors.length > 0 && <div className="error-words"><div className="section-label">需要再见一面 <span>{errors.length}</span></div><div className="error-list">{errors.slice(0, 6).map((card) => <span key={card.cardId}>{card.word}<small>{card.pos}</small></span>)}</div></div>}<div className="result-actions"><button className="button primary large" onClick={onAgain}><RotateCcw size={17} />再来一局</button><button className="button ghost large" onClick={onStats}><BarChart3 size={17} />学习统计</button><button className="text-button" onClick={onHome}>返回首页</button></div></section>
}

function LibraryPage({ library, review, onBack }: { library: CardRecord[]; review: ReviewStore; onBack: () => void }) {
  const [query, setQuery] = useState('')
  const [level, setLevel] = useState<number | 'all'>('all')
  const [visibleCount, setVisibleCount] = useState(80)
  const normalizedQuery = query.trim().toLowerCase()
  const filtered = useMemo(() => library.filter((card) => {
    const matchesQuery = !normalizedQuery || [card.word, card.meaning, card.pos].some((value) => value.toLowerCase().includes(normalizedQuery))
    return matchesQuery && (level === 'all' || card.frequencyLevel === level)
  }), [library, normalizedQuery, level])
  const visibleCards = filtered.slice(0, visibleCount)

  function changeFilter(nextLevel: number | 'all') {
    setLevel(nextLevel)
    setVisibleCount(80)
  }

  return <section className="library-page"><div className="library-heading"><div><button className="back-link" onClick={onBack}><ChevronRight size={15} className="back-arrow" />返回首页</button><div className="eyebrow"><span className="eyebrow-dot" /> CET-6 WORD LIBRARY</div><h1>全部单词</h1><p>按英文、词性或中文释义检索你的词汇牌库。</p></div><div className="library-total"><strong>{library.length.toLocaleString()}</strong><span>张词卡</span></div></div><div className="library-toolbar"><label className="library-search"><Search size={17} /><input value={query} onChange={(event) => { setQuery(event.target.value); setVisibleCount(80) }} placeholder="搜索英文、中文释义或词性" aria-label="搜索单词" />{query && <button type="button" onClick={() => { setQuery(''); setVisibleCount(80) }} aria-label="清除搜索"><X size={15} /></button>}</label><div className="library-filter" role="group" aria-label="筛选频率等级"><span>频率</span><button className={level === 'all' ? 'active' : ''} onClick={() => changeFilter('all')}>全部</button>{[1, 2, 3, 4, 5].map((item) => <button key={item} className={level === item ? 'active' : ''} onClick={() => changeFilter(item)}>L{item}</button>)}</div></div><div className="library-summary">显示 {visibleCards.length.toLocaleString()} / {filtered.length.toLocaleString()} 张词卡</div><div className="library-list">{visibleCards.map((card) => { const record = review[card.cardId]; return <article className="library-row" key={card.cardId}><div className="library-word"><div className="library-word-line"><strong>{card.word}</strong><button className="speech-button library-speech-button" aria-label={`播放 ${card.word} 的发音`} onClick={() => speakWord(card.word, card.pos)}><Volume2 size={15} /></button></div><small>{card.phonetic || '/ pronunciation /'}</small></div><div className="library-pos">{card.pos}</div><div className="library-meaning">{card.meaning}</div><div className="library-meta"><span className={`level-dot level-${card.frequencyLevel}`}>L{card.frequencyLevel}</span><small>{record ? `${record.correct}/${record.attempts} 正确` : '未复习'}</small></div></article> })}{visibleCards.length === 0 && <div className="library-empty"><BookOpen size={20} />没有找到符合条件的词卡。</div>}</div>{visibleCards.length < filtered.length && <button className="button ghost library-load-more" onClick={() => setVisibleCount((count) => count + 80)}>加载更多<ChevronRight size={16} /></button>}</section>
}

function Stats({ review, learning, library, stats, onReset, onMistakes, onBack }: { review: ReviewStore; learning: LearningStore; library: CardRecord[]; stats: ReturnType<typeof allReviewStats>; onReset: () => void; onMistakes: () => void; onBack: () => void }) {
  const levelStats = [1, 2, 3, 4, 5].map((level) => { const ids = new Set(library.filter((card) => card.frequencyLevel === level).map((card) => card.cardId)); const records = Object.values(review).filter((record) => ids.has(record.cardId)); return { level, attempts: records.reduce((sum, item) => sum + item.attempts, 0), correct: records.reduce((sum, item) => sum + item.correct, 0) } })
  const mistakes = getReviewMistakes(review).slice(0, 5)
  const learningMistakes = getLearningMistakes(learning).slice(0, 5)
  const learnedToday = getTodayLearnedCount(learning)
  const completedDecks = Object.values(learning.decks).filter((deck) => deck.lastCompletedAt > 0).length
  return <section className="stats-page"><div className="stats-heading"><div><button className="back-link" onClick={onBack}>← 返回首页</button><div className="eyebrow"><span className="eyebrow-dot" /> MEMORY LEDGER</div><h1>学习统计</h1><p>你的每一次回忆，都会让下一次抽牌更懂你。</p></div><div className="stats-heading-actions"><button className="button ghost" onClick={onMistakes}><Target size={15} />查看全部错题</button><button className="reset-button" onClick={onReset}>清除练习记录</button></div></div><div className="stat-overview"><div><span>已学习词卡</span><strong>{stats.studied}</strong><small>/ {library.length.toLocaleString()}</small></div><div><span>总答题次数</span><strong>{stats.attempts}</strong></div><div><span>累计正确率</span><strong>{percent(stats.correct, stats.attempts)}</strong></div><div><span>错题数量</span><strong className="accent-red">{stats.incorrect}</strong></div></div><div className="learning-overview"><div><span>今日学习</span><strong>{learnedToday}</strong><small>张独立卡片</small></div><div><span>已完成卡组</span><strong>{completedDecks}</strong><small>组</small></div><div><span>学习错题</span><strong className="accent-red">{learningMistakes.length}</strong><small>项</small></div></div><div className="stats-grid"><div className="stats-panel"><div className="panel-heading"><div><span className="section-label">练习频率等级表现</span><h2>越难的词，越值得出现在手中</h2></div><BarChart3 size={19} /></div><div className="level-chart">{levelStats.map((item) => <div className="level-row" key={item.level}><span className={`level-dot level-${item.level}`}>L{item.level}</span><div className="level-bar"><span style={{ width: `${Math.max(item.attempts ? 8 : 0, item.attempts ? (item.correct / item.attempts) * 100 : 0)}%` }} /></div><strong>{percent(item.correct, item.attempts)}</strong><small>{item.attempts} 次</small></div>)}</div></div><div className="stats-panel"><div className="panel-heading"><div><span className="section-label">练习错题回访</span><h2>最近 5 个错词</h2></div><Target size={19} /></div>{mistakes.length === 0 ? <div className="stats-empty"><Check size={18} />还没有练习错题记录。</div> : <div className="mistake-list">{mistakes.map((record) => { const card = library.find((item) => item.cardId === record.cardId); return card ? <div className="mistake-row" key={record.cardId}><span className="mistake-word">{card.word}<small>{card.pos}</small></span><span className="mistake-meaning">{card.meaning}</span><strong>{record.incorrect}<small>错</small></strong></div> : null })}</div>}</div><div className="stats-panel learning-mistakes-panel"><div className="panel-heading"><div><span className="section-label">学习错题本</span><h2>最近 5 个错词</h2></div><BookOpen size={19} /></div>{learningMistakes.length === 0 ? <div className="stats-empty"><Check size={18} />还没有学习错题。</div> : <div className="mistake-list">{learningMistakes.map((memory) => { const card = library.find((item) => item.cardId === memory.cardId); return card ? <div className="mistake-row" key={`${memory.deckId}-${memory.cardId}`}><span className="mistake-word">{card.word}<small>{card.pos}</small></span><span className="mistake-meaning">{card.meaning}<small className="mistake-time">{new Date(memory.lastIncorrectAt).toLocaleString()}</small></span><strong>{memory.incorrectCount}<small>错</small></strong></div> : null })}</div>}</div></div></section>
}

function AccountsPage({ registry, onCreate, onSwitch, onDelete, onExport, onImport, onBack }: { registry: AccountRegistry; onCreate: (username: string) => void; onSwitch: (username: string) => void; onDelete: (username: string) => void; onExport: () => void; onImport: (file: File) => Promise<boolean>; onBack: () => void }) {
  const [username, setUsername] = useState('')
  const [message, setMessage] = useState('')

  function create() {
    const value = username.trim()
    if (!value) {
      setMessage('请输入用户名。')
      return
    }
    if (registry.accounts[value]) {
      setMessage('这个用户名已经存在。')
      return
    }
    onCreate(value)
    setUsername('')
    setMessage('账号已创建并切换。')
  }

  return <section className="account-page"><button className="back-link" onClick={onBack}>← 返回首页</button><div className="account-heading"><div><div className="eyebrow"><span className="eyebrow-dot" /> ACCOUNT ARCHIVE</div><h1>账号管理</h1><p>用户名就是凭证，不设置密码。每个账号拥有独立的学习、练习、错题和残局记录。</p></div><div className="account-current"><UserRound size={18} /><span>当前账号</span><strong>{registry.activeUsername}</strong></div></div><div className="account-toolbar"><label className="account-create"><UserRound size={17} /><input value={username} onChange={(event) => { setUsername(event.target.value); setMessage('') }} onKeyDown={(event) => { if (event.key === 'Enter') create() }} placeholder="输入新用户名" maxLength={32} aria-label="新用户名" /><button className="button primary" onClick={create}><UserRound size={15} />新建账号</button></label><div className="account-file-actions"><button className="button ghost" onClick={onExport}><Download size={15} />导出当前账号</button><label className="button ghost account-import"><Upload size={15} />导入账号文件<input type="file" accept="application/json,.json" onChange={async (event) => { const file = event.target.files?.[0]; if (file) setMessage(await onImport(file) ? '账号文件已导入并切换。' : '账号文件无效，未导入任何数据。'); event.target.value = '' }} /></label></div></div>{message && <p className="account-message">{message}</p>}<div className="account-list"><div className="panel-heading"><div><span className="section-label">本机账号</span><h2>{Object.keys(registry.accounts).length} 个账号</h2></div><UserRound size={19} /></div>{Object.values(registry.accounts).sort((a, b) => a.username.localeCompare(b.username)).map((account) => <article className={`account-row ${account.username === registry.activeUsername ? 'active' : ''}`} key={account.username}><div className="account-row-icon"><UserRound size={18} /></div><div className="account-row-copy"><strong>{account.username}</strong><small>{account.username === registry.activeUsername ? '正在使用' : `最近使用：${new Date(account.lastUsedAt).toLocaleString()}`}</small></div><div className="account-row-actions">{account.username !== registry.activeUsername && <button className="button primary" onClick={() => onSwitch(account.username)}><LogOut size={14} />切换</button>}{account.username !== 'default' && <button className="icon-text-button danger-text" onClick={() => { if (window.confirm(`确定删除账号“${account.username}”及其全部记录吗？`)) onDelete(account.username) }}><Trash2 size={15} />删除</button>}</div></article>)}</div><div className="account-note"><Download size={16} /><span>导出的 JSON 只包含账号信息和学习数据，不包含密码。把文件带到另一台电脑后，可在本项目的账号管理中直接导入。</span></div></section>
}
