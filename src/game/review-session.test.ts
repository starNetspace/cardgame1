import { describe, expect, it } from 'vitest'
import { createReviewSession, normalizeCardMemoryStore, planDeal, recordAnswer, settleUnshownRequeue } from './review'

const DAY = 24 * 60 * 60 * 1000
const rng = () => 0.5

function startOfDay(ms: number): number {
  const date = new Date(ms)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

function dayDiff(now: number, dueAt: number): number {
  return Math.round((startOfDay(dueAt) - startOfDay(now)) / DAY)
}

const NOW = new Date(2026, 7, 31, 10, 0, 0, 0).getTime()

describe('four-new-one-old rhythm', () => {
  it('deals a review card as the fifth card when due cards exist', () => {
    const { dealt } = planDeal(createReviewSession(), ['n1', 'n2', 'n3', 'n4', 'n5', 'n6'], ['d1'], 5)
    expect(dealt.map((item) => item.source)).toEqual(['new', 'new', 'new', 'new', 'due'])
    expect(dealt.filter((item) => item.source === 'due').map((item) => item.cardId)).toEqual(['d1'])
  })

  it('deals only new cards when nothing is due', () => {
    const { dealt } = planDeal(createReviewSession(), ['n1', 'n2', 'n3', 'n4', 'n5'], [], 5)
    expect(dealt.map((item) => item.source)).toEqual(['new', 'new', 'new', 'new', 'new'])
  })

  it('keeps the counter in-memory and does not let requeue reset it', () => {
    let session = recordAnswer(createReviewSession(), 'x', false, rng)
    session = { ...session, answeredCount: 100 }
    const { dealt, nextSession } = planDeal(session, ['n1', 'n2', 'n3', 'n4', 'n5'], [], 5)
    expect(dealt[0]).toEqual({ cardId: 'x', source: 'requeue' })
    expect(dealt.filter((item) => item.source === 'new')).toHaveLength(4)
    expect(nextSession.newSinceReview).toBe(4)
  })

  it('deals due cards directly in a review run (fourNewOneOld disabled)', () => {
    const { dealt } = planDeal(createReviewSession(), [], ['d1', 'd2', 'd3'], 3, { fourNewOneOld: false })
    expect(dealt.map((item) => item.source)).toEqual(['due', 'due', 'due'])
    expect(dealt.map((item) => item.cardId)).toEqual(['d1', 'd2', 'd3'])
  })
})

describe('in-session requeue', () => {
  it('schedules a requeue 5~8 answers after a mistake', () => {
    const low = recordAnswer(createReviewSession(), 'x', false, () => 0)
    const high = recordAnswer(createReviewSession(), 'x', false, () => 0.999)
    expect(low.requeueScheduled[0].showAtAnswer).toBe(6)
    expect(high.requeueScheduled[0].showAtAnswer).toBe(9)
  })

  it('caps each card at two requeues per session', () => {
    let session = recordAnswer(createReviewSession(), 'x', false, rng)
    session = { ...session, answeredCount: 100 }
    const first = planDeal(session, [], [], 1)
    expect(first.dealt[0]).toEqual({ cardId: 'x', source: 'requeue' })

    let second = recordAnswer(first.nextSession, 'x', false, rng)
    second = { ...second, answeredCount: 200 }
    const secondDeal = planDeal(second, [], [], 1)
    expect(secondDeal.dealt[0]).toEqual({ cardId: 'x', source: 'requeue' })

    const third = recordAnswer(secondDeal.nextSession, 'x', false, rng)
    expect(third.requeueScheduled).toHaveLength(0)
  })

  it('does not select a queued card through the due channel', () => {
    const session = recordAnswer(createReviewSession(), 'd1', false, rng)
    const { dealt } = planDeal(session, ['n1', 'n2', 'n3', 'n4', 'n5'], ['d1'], 5)
    expect(dealt.some((item) => item.cardId === 'd1' && item.source === 'due')).toBe(false)
  })

  it('deduplicates due-channel cards to at most one appearance', () => {
    const first = planDeal(createReviewSession(), [], ['d1'], 1, { fourNewOneOld: false })
    expect(first.dealt).toEqual([{ cardId: 'd1', source: 'due' }])
    const second = planDeal(first.nextSession, [], ['d1'], 1, { fourNewOneOld: false })
    expect(second.dealt).toEqual([])
  })
})

describe('session-end settle', () => {
  it('turns un-shown requeue cards into a same-day due', () => {
    const store = normalizeCardMemoryStore({ x: { cardId: 'x', quality: 'gold', streak: 0, dueAt: NOW + 30 * DAY, history: [], lapses: 0 } })
    const session = recordAnswer(createReviewSession(), 'x', false, rng)
    const settled = settleUnshownRequeue(store, session, NOW, rng)
    expect(dayDiff(NOW, settled['x'].dueAt)).toBe(0)
  })
})
