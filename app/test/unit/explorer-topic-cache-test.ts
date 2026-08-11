import assert from 'node:assert'
import { beforeEach, describe, it } from 'node:test'

import { IAPISearchResponse, IAPITopicSearchItem } from '../../src/lib/api'
import {
  ExplorerTopicCacheFreshDuration,
  ExplorerTopicCacheMaxAge,
  ExplorerTopicCacheStorageKey,
  ExplorerTopicSearchCacheLimit,
  getCachedExplorerTopics,
  setCachedExplorerTopics,
} from '../../src/lib/explorer-topic-cache'

const endpoint = 'https://api.github.com'

if (globalThis.localStorage === undefined) {
  const values = new Map<string, string>()
  Object.assign(globalThis, {
    localStorage: {
      get length() {
        return values.size
      },
      clear: () => values.clear(),
      getItem: (key: string) => values.get(key) ?? null,
      key: (index: number) => Array.from(values.keys())[index] ?? null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, value),
    } as Storage,
  })
}

function results(name: string): IAPISearchResponse<IAPITopicSearchItem> {
  return {
    total_count: 1,
    incomplete_results: false,
    items: [
      {
        name,
        display_name: null,
        short_description: null,
        featured: false,
        curated: false,
        score: 1,
        stargazer_count: 10,
      },
    ],
  }
}

describe('Explorer topic cache', () => {
  beforeEach(() => localStorage.clear())

  it('distinguishes fresh, stale, and expired entries', () => {
    const now = ExplorerTopicCacheMaxAge * 2
    const request = { kind: 'popular' } as const

    setCachedExplorerTopics(endpoint, request, results('fresh'), now)
    assert.equal(
      getCachedExplorerTopics(
        endpoint,
        request,
        now + ExplorerTopicCacheFreshDuration
      )?.freshness,
      'fresh'
    )
    assert.equal(
      getCachedExplorerTopics(
        endpoint,
        request,
        now + ExplorerTopicCacheFreshDuration + 1
      )?.freshness,
      'stale'
    )
    assert.equal(
      getCachedExplorerTopics(
        endpoint,
        request,
        now + ExplorerTopicCacheMaxAge + 1
      ),
      null
    )
  })

  it('isolates endpoints, normalized queries, and pages', () => {
    const request = {
      kind: 'search',
      query: '  React   is:featured ',
      page: 1,
    } as const
    setCachedExplorerTopics(endpoint, request, results('react'))

    assert.equal(
      getCachedExplorerTopics(`${endpoint}/`, {
        kind: 'search',
        query: 'react is:featured',
        page: 1,
      })?.results.items[0].name,
      'react'
    )
    assert.equal(
      getCachedExplorerTopics('https://enterprise.example/api/v3', request),
      null
    )
    assert.equal(
      getCachedExplorerTopics(endpoint, { ...request, page: 2 }),
      null
    )
    assert.equal(
      getCachedExplorerTopics(endpoint, {
        ...request,
        query: 'react is:curated',
      }),
      null
    )
  })

  it('keeps the most recently accessed search entries', () => {
    const now = ExplorerTopicCacheMaxAge * 2
    for (let i = 0; i < ExplorerTopicSearchCacheLimit; i++) {
      setCachedExplorerTopics(
        endpoint,
        { kind: 'search', query: `topic-${i}`, page: 1 },
        results(`topic-${i}`),
        now + i
      )
    }

    assert.ok(
      getCachedExplorerTopics(
        endpoint,
        { kind: 'search', query: 'topic-0', page: 1 },
        now + ExplorerTopicSearchCacheLimit
      )
    )
    setCachedExplorerTopics(
      endpoint,
      { kind: 'search', query: 'topic-new', page: 1 },
      results('topic-new'),
      now + ExplorerTopicSearchCacheLimit + 1
    )

    assert.ok(
      getCachedExplorerTopics(
        endpoint,
        {
          kind: 'search',
          query: 'topic-0',
          page: 1,
        },
        now + ExplorerTopicSearchCacheLimit + 2
      )
    )
    assert.equal(
      getCachedExplorerTopics(
        endpoint,
        {
          kind: 'search',
          query: 'topic-1',
          page: 1,
        },
        now + ExplorerTopicSearchCacheLimit + 2
      ),
      null
    )
  })

  it('ignores corrupt and incompatible stored data', () => {
    localStorage.setItem(ExplorerTopicCacheStorageKey, '{broken')
    assert.equal(getCachedExplorerTopics(endpoint, { kind: 'popular' }), null)

    localStorage.setItem(
      ExplorerTopicCacheStorageKey,
      JSON.stringify({ version: 99, entries: [] })
    )
    assert.equal(getCachedExplorerTopics(endpoint, { kind: 'popular' }), null)
  })
})
