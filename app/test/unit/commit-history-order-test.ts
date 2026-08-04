import { beforeEach, describe, it } from 'node:test'
import assert from 'node:assert'
import { CommitHistoryOrder } from '../../src/lib/app-state'
import {
  commitHistoryOrderStorageKey,
  getCommitHistoryOrder,
  setCommitHistoryOrder,
} from '../../src/lib/commit-history-order'

describe('commit history order', () => {
  beforeEach(() => localStorage.clear())

  it('defaults to newest first', () => {
    assert.equal(getCommitHistoryOrder(), CommitHistoryOrder.NewestFirst)
  })

  it('persists oldest first globally', () => {
    setCommitHistoryOrder(CommitHistoryOrder.OldestFirst)

    assert.equal(getCommitHistoryOrder(), CommitHistoryOrder.OldestFirst)
  })

  it('falls back to newest first for an invalid value', () => {
    localStorage.setItem(commitHistoryOrderStorageKey, 'not-an-order')

    assert.equal(getCommitHistoryOrder(), CommitHistoryOrder.NewestFirst)
  })
})
