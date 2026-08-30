// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { CardView, QuestionModal } from './App'
import { buildSpellingQuestion } from './game/questions'
import type { RuntimeCard } from './types'

afterEach(cleanup)

const spellingCard: RuntimeCard = {
  instanceId: 'i-spell',
  face: 'spelling',
  card: { cardId: 'c1', word: 'abandon', phonetic: '/əˈbændən/', pos: 'v', meaning: '放弃', frequencyLevel: 2, frequencyLabel: '较高频', effectType: 'attack' },
}

const meaningCard: RuntimeCard = { ...spellingCard, face: 'meaning' }

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
