import { describe, expect, it } from 'vitest'
import { resolveAudioPath } from './speech'

const manifest = {
  version: 1,
  files: {
    abandon: '/audio/words/a/abandon.mp3',
    'record|v': '/audio/words/r/record-v.mp3',
  },
}

describe('audio manifest lookup', () => {
  it('prefers a word and part-of-speech override', () => {
    expect(resolveAudioPath(manifest, 'RECORD', ' V ')).toBe('/audio/words/r/record-v.mp3')
  })

  it('falls back from a missing part-of-speech override to the word audio', () => {
    expect(resolveAudioPath(manifest, ' abandon ', 'n')).toBe('/audio/words/a/abandon.mp3')
  })

  it('returns a normal word audio path without a part of speech', () => {
    expect(resolveAudioPath(manifest, 'abandon')).toBe('/audio/words/a/abandon.mp3')
  })

  it('returns undefined when the manifest has no matching audio', () => {
    expect(resolveAudioPath(manifest, 'unknown', 'n')).toBeUndefined()
  })
})

