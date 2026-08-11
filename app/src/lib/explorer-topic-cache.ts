import { IAPISearchResponse, IAPITopicSearchItem } from './api'
import { getObject, setObject } from './local-storage'

const ExplorerTopicCacheVersion = 1
export const ExplorerTopicCacheStorageKey = 'explorer-topic-cache-v1'
export const ExplorerTopicCacheFreshDuration = 24 * 60 * 60 * 1000
export const ExplorerTopicCacheMaxAge = 7 * 24 * 60 * 60 * 1000
export const ExplorerTopicSearchCacheLimit = 12

export type ExplorerTopicCacheRequest =
  | { readonly kind: 'popular' }
  | {
      readonly kind: 'search'
      readonly query: string
      readonly page: number
    }

export interface IExplorerTopicCacheHit {
  readonly freshness: 'fresh' | 'stale'
  readonly results: IAPISearchResponse<IAPITopicSearchItem>
}

interface IExplorerTopicCacheEntry {
  readonly key: string
  readonly kind: ExplorerTopicCacheRequest['kind']
  readonly fetchedAt: number
  readonly lastAccessedAt: number
  readonly results: IAPISearchResponse<IAPITopicSearchItem>
}

interface IExplorerTopicCacheStore {
  readonly version: typeof ExplorerTopicCacheVersion
  readonly entries: ReadonlyArray<IExplorerTopicCacheEntry>
}

function normalizeEndpoint(endpoint: string): string {
  return endpoint.replace(/\/+$/, '')
}

function normalizeQuery(query: string): string {
  return query.trim().replace(/\s+/g, ' ').toLocaleLowerCase()
}

function cacheKey(
  endpoint: string,
  request: ExplorerTopicCacheRequest
): string {
  const normalizedEndpoint = normalizeEndpoint(endpoint)
  return request.kind === 'popular'
    ? JSON.stringify([normalizedEndpoint, request.kind])
    : JSON.stringify([
        normalizedEndpoint,
        request.kind,
        normalizeQuery(request.query),
        request.page,
      ])
}

function isTopic(value: unknown): value is IAPITopicSearchItem {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const topic = value as Partial<IAPITopicSearchItem>
  return (
    typeof topic.name === 'string' &&
    (topic.display_name === null || typeof topic.display_name === 'string') &&
    (topic.short_description === null ||
      typeof topic.short_description === 'string') &&
    typeof topic.featured === 'boolean' &&
    typeof topic.curated === 'boolean' &&
    typeof topic.score === 'number' &&
    (topic.stargazer_count === undefined ||
      typeof topic.stargazer_count === 'number')
  )
}

function isTopicSearchResponse(
  value: unknown
): value is IAPISearchResponse<IAPITopicSearchItem> {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const response = value as Partial<IAPISearchResponse<IAPITopicSearchItem>>
  return (
    typeof response.total_count === 'number' &&
    typeof response.incomplete_results === 'boolean' &&
    Array.isArray(response.items) &&
    response.items.every(isTopic)
  )
}

function isCacheEntry(value: unknown): value is IExplorerTopicCacheEntry {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const entry = value as Partial<IExplorerTopicCacheEntry>
  return (
    typeof entry.key === 'string' &&
    (entry.kind === 'popular' || entry.kind === 'search') &&
    typeof entry.fetchedAt === 'number' &&
    typeof entry.lastAccessedAt === 'number' &&
    isTopicSearchResponse(entry.results)
  )
}

function emptyStore(): IExplorerTopicCacheStore {
  return { version: ExplorerTopicCacheVersion, entries: [] }
}

function readStore(): IExplorerTopicCacheStore {
  try {
    const stored = getObject<unknown>(ExplorerTopicCacheStorageKey)
    if (typeof stored !== 'object' || stored === null) {
      return emptyStore()
    }

    const candidate = stored as Partial<IExplorerTopicCacheStore>
    if (
      candidate.version !== ExplorerTopicCacheVersion ||
      !Array.isArray(candidate.entries) ||
      !candidate.entries.every(isCacheEntry)
    ) {
      return emptyStore()
    }

    return candidate as IExplorerTopicCacheStore
  } catch {
    return emptyStore()
  }
}

function writeStore(store: IExplorerTopicCacheStore): void {
  try {
    setObject(ExplorerTopicCacheStorageKey, store)
  } catch {
    // This cache is an optimization. Storage or quota failures must not block
    // the normal GitHub API loading path.
  }
}

function retainUsableEntries(
  entries: ReadonlyArray<IExplorerTopicCacheEntry>,
  now: number
): ReadonlyArray<IExplorerTopicCacheEntry> {
  return entries.filter(
    entry => now - entry.fetchedAt <= ExplorerTopicCacheMaxAge
  )
}

export function getCachedExplorerTopics(
  endpoint: string,
  request: ExplorerTopicCacheRequest,
  now: number = Date.now()
): IExplorerTopicCacheHit | null {
  const store = readStore()
  const usableEntries = retainUsableEntries(store.entries, now)
  const key = cacheKey(endpoint, request)
  const entry = usableEntries.find(candidate => candidate.key === key)

  if (entry === undefined) {
    if (usableEntries.length !== store.entries.length) {
      writeStore({ ...store, entries: usableEntries })
    }
    return null
  }

  const touchedEntry = { ...entry, lastAccessedAt: now }
  writeStore({
    ...store,
    entries: usableEntries.map(candidate =>
      candidate.key === key ? touchedEntry : candidate
    ),
  })

  const age = Math.max(0, now - entry.fetchedAt)
  return {
    freshness: age <= ExplorerTopicCacheFreshDuration ? 'fresh' : 'stale',
    results: entry.results,
  }
}

export function setCachedExplorerTopics(
  endpoint: string,
  request: ExplorerTopicCacheRequest,
  results: IAPISearchResponse<IAPITopicSearchItem>,
  now: number = Date.now()
): void {
  const store = readStore()
  const key = cacheKey(endpoint, request)
  const nextEntry: IExplorerTopicCacheEntry = {
    key,
    kind: request.kind,
    fetchedAt: now,
    lastAccessedAt: now,
    results,
  }
  const usableEntries = retainUsableEntries(store.entries, now).filter(
    entry => entry.key !== key
  )
  const popularEntries = usableEntries.filter(entry => entry.kind === 'popular')
  const searchEntries = [
    ...usableEntries.filter(entry => entry.kind === 'search'),
  ]

  if (nextEntry.kind === 'popular') {
    popularEntries.push(nextEntry)
  } else {
    searchEntries.push(nextEntry)
  }

  searchEntries.sort(
    (left, right) => right.lastAccessedAt - left.lastAccessedAt
  )
  writeStore({
    version: ExplorerTopicCacheVersion,
    entries: [
      ...popularEntries,
      ...searchEntries.slice(0, ExplorerTopicSearchCacheLimit),
    ],
  })
}
