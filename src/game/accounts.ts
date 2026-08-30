import type { AccountExport, AccountInfo, AccountRegistry, BattleStore, LearningStore, ReviewStore } from '../types'
import { getActiveUsername, loadBattleStore, loadLearningStore, loadReviewStore, normalizeUsername, saveBattleStore, saveLearningStore, saveReviewStore, setActiveUsername } from './review'

const ACCOUNT_REGISTRY_KEY = 'lexicon-duel-accounts-v1'
const DEFAULT_USERNAME = 'default'

function accountKey(username: string, kind: 'review' | 'learning' | 'battles'): string {
  return `lexicon-duel-account-v1:${encodeURIComponent(normalizeUsername(username) || DEFAULT_USERNAME)}:${kind}`
}

function emptyRegistry(): AccountRegistry {
  const now = Date.now()
  return { version: 1, activeUsername: DEFAULT_USERNAME, accounts: { [DEFAULT_USERNAME]: { username: DEFAULT_USERNAME, createdAt: now, lastUsedAt: now } } }
}

function isAccountInfo(value: unknown, username: string): value is AccountInfo {
  if (!value || typeof value !== 'object') return false
  const info = value as AccountInfo
  return info.username === username && Number.isFinite(info.createdAt) && Number.isFinite(info.lastUsedAt)
}

export function isAccountRegistry(value: unknown): value is AccountRegistry {
  if (!value || typeof value !== 'object') return false
  const registry = value as AccountRegistry
  if (registry.version !== 1 || typeof registry.activeUsername !== 'string' || !registry.accounts || typeof registry.accounts !== 'object') return false
  return Boolean(registry.accounts[registry.activeUsername] && Object.entries(registry.accounts).every(([username, info]) => isAccountInfo(info, username)))
}

export function loadAccountRegistry(): AccountRegistry {
  try {
    const parsed = JSON.parse(localStorage.getItem(ACCOUNT_REGISTRY_KEY) ?? 'null')
    if (isAccountRegistry(parsed)) {
      setActiveUsername(parsed.activeUsername)
      return parsed
    }
  } catch { /* local-only storage can be unavailable */ }
  const fallback = emptyRegistry()
  try { localStorage.setItem(ACCOUNT_REGISTRY_KEY, JSON.stringify(fallback)) } catch { /* local-only storage can be unavailable */ }
  setActiveUsername(fallback.activeUsername)
  return fallback
}

export function saveAccountRegistry(registry: AccountRegistry): void {
  try { localStorage.setItem(ACCOUNT_REGISTRY_KEY, JSON.stringify(registry)) } catch { /* local-only storage can be unavailable */ }
}

export function createAccount(registry: AccountRegistry, username: string, now = Date.now()): AccountRegistry | null {
  const normalized = normalizeUsername(username)
  if (!normalized || normalized.toLowerCase() === 'default' || registry.accounts[normalized]) return null
  const next = { ...registry, activeUsername: normalized, accounts: { ...registry.accounts, [normalized]: { username: normalized, createdAt: now, lastUsedAt: now } } }
  setActiveUsername(normalized)
  saveAccountRegistry(next)
  return next
}

export function switchAccount(registry: AccountRegistry, username: string, now = Date.now()): AccountRegistry | null {
  const normalized = normalizeUsername(username)
  const current = registry.accounts[normalized]
  if (!current) return null
  const next = { ...registry, activeUsername: normalized, accounts: { ...registry.accounts, [normalized]: { ...current, lastUsedAt: now } } }
  setActiveUsername(normalized)
  saveAccountRegistry(next)
  return next
}

export function deleteAccount(registry: AccountRegistry, username: string): AccountRegistry {
  const normalized = normalizeUsername(username)
  if (normalized === DEFAULT_USERNAME || !registry.accounts[normalized]) return registry
  const accounts = { ...registry.accounts }
  delete accounts[normalized]
  try {
    localStorage.removeItem(accountKey(normalized, 'review'))
    localStorage.removeItem(accountKey(normalized, 'learning'))
    localStorage.removeItem(accountKey(normalized, 'battles'))
  } catch { /* local-only storage can be unavailable */ }
  const activeUsername = registry.activeUsername === normalized ? DEFAULT_USERNAME : registry.activeUsername
  const next = { ...registry, activeUsername, accounts }
  setActiveUsername(activeUsername)
  saveAccountRegistry(next)
  return next
}

export function accountData(username = getActiveUsername()): { review: ReviewStore; learning: LearningStore; battles: BattleStore } {
  return { review: loadReviewStore(username), learning: loadLearningStore(username), battles: loadBattleStore(username) }
}

export function createAccountExport(username = getActiveUsername(), exportedAt = Date.now()): AccountExport {
  const data = accountData(username)
  return { format: 'lexicon-duel-account', version: 1, username: normalizeUsername(username), exportedAt, ...data }
}

function isReviewStore(value: unknown): value is ReviewStore {
  return Boolean(value && typeof value === 'object' && Object.values(value as Record<string, unknown>).every((item) => item && typeof item === 'object'))
}

function isLearningStore(value: unknown): value is LearningStore {
  if (!value || typeof value !== 'object') return false
  const store = value as LearningStore
  return Boolean(store.decks && typeof store.decks === 'object' && store.cards && typeof store.cards === 'object')
}

function isBattleStore(value: unknown): value is BattleStore {
  return Boolean(value && typeof value === 'object')
}

export function parseAccountExport(value: unknown): AccountExport | null {
  if (!value || typeof value !== 'object') return null
  const data = value as Partial<AccountExport>
  if (data.format !== 'lexicon-duel-account' || data.version !== 1 || typeof data.username !== 'string' || !normalizeUsername(data.username)) return null
  if (!isReviewStore(data.review) || !isLearningStore(data.learning) || !isBattleStore(data.battles)) return null
  return data as AccountExport
}

export function importAccountData(registry: AccountRegistry, data: AccountExport, overwrite = true, now = Date.now()): AccountRegistry | null {
  const username = normalizeUsername(data.username)
  if (!username) return null
  if (registry.accounts[username] && !overwrite) return null
  const nextRegistry = registry.accounts[username]
    ? { ...registry, activeUsername: username, accounts: { ...registry.accounts, [username]: { ...registry.accounts[username], lastUsedAt: now } } }
    : { ...registry, activeUsername: username, accounts: { ...registry.accounts, [username]: { username, createdAt: now, lastUsedAt: now } } }
  setActiveUsername(username)
  saveReviewStore(data.review, username)
  saveLearningStore(data.learning, username)
  // Write the complete document at once so multiple learning deck slots survive import.
  saveBattleStore(data.battles, username)
  saveAccountRegistry(nextRegistry)
  return nextRegistry
}
