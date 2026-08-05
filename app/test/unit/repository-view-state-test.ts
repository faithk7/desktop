import { beforeEach, describe, it } from 'node:test'
import assert from 'node:assert'

import {
  CommitHistoryOrder,
  RepositorySectionTab,
} from '../../src/lib/app-state'
import { Branch, BranchType } from '../../src/models/branch'
import { Repository } from '../../src/models/repository'
import { Tip, TipState } from '../../src/models/tip'
import {
  clearCurrentBranchViewState,
  deleteRepositoryViewState,
  getBranchViewState,
  getRepositoryViewState,
  storeBranchViewState,
  updateRepositoryViewState,
} from '../../src/lib/repository-view-state'
import { commitHistoryOrderStorageKey } from '../../src/lib/commit-history-order'

const repository = new Repository('/some/repository', 1, null, false)
const otherRepository = new Repository('/some/other-repository', 2, null, false)

function makeTip(name: string): Tip {
  return {
    kind: TipState.Valid,
    branch: new Branch(
      name,
      null,
      { sha: `${name}-sha` },
      BranchType.Local,
      `refs/heads/${name}`
    ),
  }
}

describe('repository view state', () => {
  beforeEach(() => localStorage.clear())

  it('uses the legacy history order as the default', () => {
    localStorage.setItem(
      commitHistoryOrderStorageKey,
      CommitHistoryOrder.OldestFirst
    )

    const state = getRepositoryViewState(repository)
    assert.equal(state.order, CommitHistoryOrder.OldestFirst)
    assert.equal(state.selectedSection, RepositorySectionTab.Changes)
  })

  it('keeps repository and branch state isolated', () => {
    const main = makeTip('main')
    const feature = makeTip('feature')

    updateRepositoryViewState(repository, state => ({
      ...state,
      selectedSection: RepositorySectionTab.History,
      order: CommitHistoryOrder.OldestFirst,
    }))
    storeBranchViewState(repository, main, {
      selectedCommitSHAs: ['main-sha'],
      isContiguous: true,
      selectedFileID: 'Modified+README.md',
    })
    storeBranchViewState(repository, feature, {
      selectedCommitSHAs: ['feature-sha'],
      isContiguous: true,
      selectedFileID: null,
    })

    assert.deepStrictEqual(getBranchViewState(repository, main), {
      branchKey: 'branch:refs/heads/main',
      selectedCommitSHAs: ['main-sha'],
      isContiguous: true,
      selectedFileID: 'Modified+README.md',
    })
    assert.deepStrictEqual(getBranchViewState(repository, feature), {
      branchKey: 'branch:refs/heads/feature',
      selectedCommitSHAs: ['feature-sha'],
      isContiguous: true,
      selectedFileID: null,
    })
    assert.equal(getBranchViewState(otherRepository, main), null)
    assert.equal(
      getRepositoryViewState(otherRepository).order,
      CommitHistoryOrder.NewestFirst
    )
  })

  it('clears only the current branch and preserves repository preferences', () => {
    const main = makeTip('main')
    const feature = makeTip('feature')
    updateRepositoryViewState(repository, state => ({
      ...state,
      selectedSection: RepositorySectionTab.History,
      order: CommitHistoryOrder.OldestFirst,
    }))
    storeBranchViewState(repository, main, {
      selectedCommitSHAs: ['main-sha'],
      isContiguous: true,
      selectedFileID: null,
    })
    storeBranchViewState(repository, feature, {
      selectedCommitSHAs: ['feature-sha'],
      isContiguous: true,
      selectedFileID: null,
    })

    assert(clearCurrentBranchViewState(repository, main))
    assert.equal(getBranchViewState(repository, main), null)
    assert.notEqual(getBranchViewState(repository, feature), null)
    assert.equal(
      getRepositoryViewState(repository).selectedSection,
      RepositorySectionTab.History
    )
    assert.equal(
      getRepositoryViewState(repository).order,
      CommitHistoryOrder.OldestFirst
    )
  })

  it('supports detached HEAD state and deletion', () => {
    const tip: Tip = { kind: TipState.Detached, currentSha: 'deadbeef' }
    storeBranchViewState(repository, tip, {
      selectedCommitSHAs: ['deadbeef'],
      isContiguous: true,
      selectedFileID: null,
    })

    assert.equal(
      getBranchViewState(repository, tip)?.branchKey,
      'detached:deadbeef'
    )
    deleteRepositoryViewState(repository)
    assert.equal(getBranchViewState(repository, tip), null)
  })

  it('ignores malformed stored data', () => {
    localStorage.setItem('repository-view-state-v1-1', '{"version":1}')
    assert.deepStrictEqual(
      getRepositoryViewState(repository),
      expectDefaultRepositoryViewState()
    )
  })
})

function expectDefaultRepositoryViewState() {
  return {
    version: 1,
    selectedSection: RepositorySectionTab.Changes,
    order: CommitHistoryOrder.NewestFirst,
    branches: [],
  }
}
