import type { CardRecord, MeaningOption, QuestionState, RuntimeCard } from '../shared/domain-types'

function shuffle<T>(items: T[], random: () => number): T[] {
  const result = [...items]
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

export function buildMeaningQuestion(card: RuntimeCard, library: CardRecord[], random: () => number = Math.random): QuestionState {
  const options: MeaningOption[] = [{ cardId: card.card.cardId, word: card.card.word, pos: card.card.pos, meaning: card.card.meaning }]
  const used = new Set([card.card.cardId, card.card.meaning])
  const otherWords = library.filter((item) => item.word.toLowerCase() !== card.card.word.toLowerCase())
  const samePartOfSpeech = otherWords.filter((item) => item.pos === card.card.pos)
  // Meaning choices should test the same grammatical target. A small custom
  // library may produce fewer than five choices, but never mixes parts of speech.
  for (const item of shuffle(samePartOfSpeech, random)) {
    if (used.has(item.meaning)) continue
    options.push({ cardId: item.cardId, word: item.word, pos: item.pos, meaning: item.meaning })
    used.add(item.meaning)
    if (options.length === 5) break
  }
  return { type: 'meaning', card, options: shuffle(options, random) }
}

export function buildSpellingQuestion(card: RuntimeCard): QuestionState {
  return { type: 'spelling', card }
}

export function buildQuestion(card: RuntimeCard, library: CardRecord[], random: () => number = Math.random): QuestionState {
  return card.face === 'meaning' ? buildMeaningQuestion(card, library, random) : buildSpellingQuestion(card)
}

export function isSpellingCorrect(answer: string, expected: string): boolean {
  return answer.trim().toLowerCase() === expected.toLowerCase()
}
