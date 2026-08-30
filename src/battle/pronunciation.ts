export interface AudioManifest {
  version?: number
  files: Record<string, string>
}

let audioManifest: AudioManifest | null = null
let manifestLoaded = false

function normalizeWord(word: string): string {
  return word.trim().toLowerCase()
}

function normalizePos(pos: string): string {
  return pos.trim().toLowerCase()
}

export function resolveAudioPath(manifest: AudioManifest | null | undefined, word: string, pos?: string): string | undefined {
  if (!manifest?.files) return undefined
  const normalizedWord = normalizeWord(word)
  const normalizedPos = pos ? normalizePos(pos) : ''
  if (normalizedPos) {
    const byPos = manifest.files[`${normalizedWord}|${normalizedPos}`]
    if (byPos) return byPos
  }
  return manifest.files[normalizedWord]
}

export async function loadAudioManifest(): Promise<AudioManifest | null> {
  if (manifestLoaded) return audioManifest
  manifestLoaded = true
  try {
    const response = await fetch('/audio/manifest.json')
    if (!response.ok) return null
    const parsed: unknown = await response.json()
    if (!parsed || typeof parsed !== 'object' || !('files' in parsed)) return null
    const files = (parsed as { files?: unknown }).files
    if (!files || typeof files !== 'object' || Array.isArray(files)) return null
    audioManifest = { version: (parsed as { version?: number }).version, files: files as Record<string, string> }
    return audioManifest
  } catch {
    // The manifest is optional. A missing manifest simply uses browser speech.
    return null
  }
}

export function speakWithSynthesis(word: string): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') return
  window.speechSynthesis.cancel()
  const utterance = new SpeechSynthesisUtterance(word)
  utterance.lang = 'en-US'
  utterance.rate = 0.9
  window.speechSynthesis.speak(utterance)
}

export function speakWord(word: string, pos?: string): void {
  const path = resolveAudioPath(audioManifest, word, pos)
  if (!path || typeof Audio === 'undefined') {
    speakWithSynthesis(word)
    return
  }

  try {
    const audio = new Audio(path)
    const playResult = audio.play()
    if (playResult && typeof playResult.catch === 'function') {
      void playResult.catch(() => speakWithSynthesis(word))
    }
  } catch {
    speakWithSynthesis(word)
  }
}

