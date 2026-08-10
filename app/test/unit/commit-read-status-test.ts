import assert from 'node:assert'
import { beforeEach, describe, it } from 'node:test'

import {
  deleteRepositoryReadCommitSHAs,
  getRepositoryReadCommitSHAs,
  storeRepositoryReadCommitSHAs,
  toggleReadCommitSHAs,
} from '../../src/lib/commit-read-status'
import { Repository } from '../../src/models/repository'

const repository = new Repository('/some/repository', 1, null, false)
const otherRepository = new Repository('/some/other-repository', 2, null, false)

describe('commit read status', () => {
  beforeEach(() => localStorage.clear())

  it('persists unique read commit SHAs per repository', () => {
    storeRepositoryReadCommitSHAs(repository, new Set(['one', 'two']))
    storeRepositoryReadCommitSHAs(otherRepository, new Set(['other']))

    assert.deepStrictEqual(
      [...getRepositoryReadCommitSHAs(repository)],
      ['one', 'two']
    )
    assert.deepStrictEqual(
      [...getRepositoryReadCommitSHAs(otherRepository)],
      ['other']
    )
  })

  it('inverts every unique selected SHA independently', () => {
    const updated = toggleReadCommitSHAs(
      new Set(['already-read', 'stays-read']),
      ['already-read', 'newly-read', 'newly-read']
    )

    assert.deepStrictEqual([...updated], ['stays-read', 'newly-read'])
  })

  it('falls back to empty state for malformed storage', () => {
    localStorage.setItem('repository-commit-read-status-v1-1', '{bad json')

    assert.equal(getRepositoryReadCommitSHAs(repository).size, 0)
  })

  it('deletes only the requested repository status', () => {
    storeRepositoryReadCommitSHAs(repository, new Set(['one']))
    storeRepositoryReadCommitSHAs(otherRepository, new Set(['other']))

    deleteRepositoryReadCommitSHAs(repository)

    assert.equal(getRepositoryReadCommitSHAs(repository).size, 0)
    assert.deepStrictEqual(
      [...getRepositoryReadCommitSHAs(otherRepository)],
      ['other']
    )
  })
})
