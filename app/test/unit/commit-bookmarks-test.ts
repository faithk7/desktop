import assert from 'node:assert'
import { beforeEach, describe, it } from 'node:test'

import {
  deleteRepositoryBookmarkedCommitSHAs,
  getRepositoryBookmarkedCommitSHAs,
  storeRepositoryBookmarkedCommitSHAs,
  toggleBookmarkedCommitSHAs,
} from '../../src/lib/commit-bookmarks'
import { Repository } from '../../src/models/repository'

const repository = new Repository('/some/repository', 1, null, false)
const otherRepository = new Repository('/some/other-repository', 2, null, false)

const storage = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    clear: () => storage.clear(),
    getItem: (key: string) => storage.get(key) ?? null,
    removeItem: (key: string) => storage.delete(key),
    setItem: (key: string, value: string) => storage.set(key, value),
  },
})

describe('commit bookmarks', () => {
  beforeEach(() => localStorage.clear())

  it('persists unique bookmarked commit SHAs per repository', () => {
    storeRepositoryBookmarkedCommitSHAs(repository, new Set(['one', 'two']))
    storeRepositoryBookmarkedCommitSHAs(otherRepository, new Set(['other']))

    assert.deepStrictEqual(
      [...getRepositoryBookmarkedCommitSHAs(repository)],
      ['one', 'two']
    )
    assert.deepStrictEqual(
      [...getRepositoryBookmarkedCommitSHAs(otherRepository)],
      ['other']
    )
  })

  it('inverts every unique selected SHA independently', () => {
    const updated = toggleBookmarkedCommitSHAs(
      new Set(['already-bookmarked', 'stays-bookmarked']),
      ['already-bookmarked', 'newly-bookmarked', 'newly-bookmarked']
    )

    assert.deepStrictEqual(
      [...updated],
      ['stays-bookmarked', 'newly-bookmarked']
    )
  })

  it('falls back to empty state for malformed storage', () => {
    localStorage.setItem('repository-commit-bookmarks-v1-1', '{bad json')

    assert.equal(getRepositoryBookmarkedCommitSHAs(repository).size, 0)
  })

  it('deletes only the requested repository bookmarks', () => {
    storeRepositoryBookmarkedCommitSHAs(repository, new Set(['one']))
    storeRepositoryBookmarkedCommitSHAs(otherRepository, new Set(['other']))

    deleteRepositoryBookmarkedCommitSHAs(repository)

    assert.equal(getRepositoryBookmarkedCommitSHAs(repository).size, 0)
    assert.deepStrictEqual(
      [...getRepositoryBookmarkedCommitSHAs(otherRepository)],
      ['other']
    )
  })
})
