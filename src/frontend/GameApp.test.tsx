// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { CardView, QuestionModal, filterCardMemoryByGrade } from './GameApp'
import { buildSpellingQuestion } from '../battle/question-engine'
import type { CardMemoryRecord, RuntimeCard } from '../shared/domain-types'

afterEach(cleanup)

const spellingCard: RuntimeCard = {
  instanceId: 'i-spell',
  face: 'spelling',
  card: { cardId: 'c1-spelling', face: 'spelling', word: 'abandon', phonetic: '/əˈbændən/', pos: 'v', meaning: '放弃', frequencyLevel: 2, frequencyLabel: '较高频', effectType: 'attack' },
}

const meaningCard: RuntimeCard = { ...spellingCard, face: 'meaning', card: { ...spellingCard.card, cardId: 'c1', face: 'meaning' } }

describe('复习/重现卡拼写题发音红线', () => {
  it('复习卡拼写题未答状态无任何发音触发元素', () => {
    render(<CardView card={spellingCard} disabled={false} source="due" onClick={() => {}} />)
    expect(screen.queryByRole('button', { name: /播放/ })).toBeNull()
    expect(document.querySelector('.speech-button')).toBeNull()
  })

  it('重现卡拼写题未答状态无任何发音触发元素', () => {
    render(<CardView card={spellingCard} disabled={false} source="requeue" onClick={() => {}} />)
    expect(screen.queryByRole('button', { name: /播放/ })).toBeNull()
    expect(document.querySelector('.speech-button')).toBeNull()
  })

  it('复习卡拼写题弹窗未答状态无发音入口', () => {
    render(<QuestionModal question={buildSpellingQuestion(spellingCard)} answer="" setAnswer={() => {}} selectedOption={null} setSelectedOption={() => {}} onSubmit={() => {}} onAbandon={() => {}} />)
    expect(screen.queryByRole('button', { name: /播放/ })).toBeNull()
    expect(document.querySelector('.speech-button')).toBeNull()
  })

  it('识义题未答状态仍有发音按钮（对照组）', () => {
    render(<CardView card={meaningCard} disabled={false} onClick={() => {}} />)
    expect(screen.getByRole('button', { name: /播放 abandon 的发音/ })).toBeTruthy()
  })
})

describe('记忆档案分级筛选', () => {
  const records: CardMemoryRecord[] = [
    { cardId: 'a', quality: 'bronze', streak: 0, dueAt: 1, history: [], lapses: 1 },
    { cardId: 'b', quality: 'gold', streak: 1, dueAt: 2, history: [], lapses: 2 },
    { cardId: 'c', quality: 'gold', streak: 2, dueAt: 3, history: [], lapses: 3 },
    { cardId: 'd', quality: 'mastered', streak: 0, dueAt: 4, history: [], lapses: 0 },
  ]

  it('「全部」返回所有记录', () => {
    expect(filterCardMemoryByGrade(records, 'all')).toEqual(records)
  })

  it('按等级过滤只返回对应等级', () => {
    expect(filterCardMemoryByGrade(records, 'gold').map((r) => r.cardId)).toEqual(['b', 'c'])
    expect(filterCardMemoryByGrade(records, 'bronze').map((r) => r.cardId)).toEqual(['a'])
    expect(filterCardMemoryByGrade(records, 'mastered').map((r) => r.cardId)).toEqual(['d'])
  })

  it('无匹配等级时返回空数组', () => {
    expect(filterCardMemoryByGrade(records, 'silver')).toEqual([])
  })
})
