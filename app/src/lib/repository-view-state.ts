import { CommitHistoryOrder, RepositorySectionTab } from './app-state'
import { getEnum, getObject, setObject } from './local-storage'
import { commitHistoryOrderStorageKey } from './commit-history-order'
import { Repository } from '../models/repository'
import { Tip, TipState } from '../models/tip'

const RepositoryViewStateVersion = 1
const RepositoryViewStateStorageKeyPrefix = 'repository-view-state-v1'

export interface IRepositoryBranchViewState {
  readonly branchKey: string
  readonly selectedCommitSHAs: ReadonlyArray<string>
  readonly isContiguous: boolean
  readonly selectedFileID: string | null
}

export interface IRepositoryViewState {
  readonly version: typeof RepositoryViewStateVersion
  readonly selectedSection: RepositorySectionTab
  readonly order: CommitHistoryOrder
  readonly branches: ReadonlyArray<IRepositoryBranchViewState>
}

function getStorageKey(repository: Repository): string {
  return `${RepositoryViewStateStorageKeyPrefix}-${repository.id}`
}

function getDefaultOrder(): CommitHistoryOrder {
  return (
    getEnum(commitHistoryOrderStorageKey, CommitHistoryOrder) ??
    CommitHistoryOrder.NewestFirst
  )
}

export function getDefaultRepositoryViewState(): IRepositoryViewState {
  return {
    version: RepositoryViewStateVersion,
    selectedSection: RepositorySectionTab.Changes,
    order: getDefaultOrder(),
    branches: [],
  }
}

function isRepositorySectionTab(value: unknown): value is RepositorySectionTab {
  return (
    value === RepositorySectionTab.Changes ||
    value === RepositorySectionTab.History
  )
}

function isCommitHistoryOrder(value: unknown): value is CommitHistoryOrder {
  return (
    value === CommitHistoryOrder.NewestFirst ||
    value === CommitHistoryOrder.OldestFirst
  )
}

function isBranchViewState(
  value: unknown
): value is IRepositoryBranchViewState {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const candidate = value as Partial<IRepositoryBranchViewState>
  return (
    typeof candidate.branchKey === 'string' &&
    Array.isArray(candidate.selectedCommitSHAs) &&
    candidate.selectedCommitSHAs.every(sha => typeof sha === 'string') &&
    typeof candidate.isContiguous === 'boolean' &&
    (candidate.selectedFileID === null ||
      typeof candidate.selectedFileID === 'string')
  )
}

function isRepositoryViewState(value: unknown): value is IRepositoryViewState {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const candidate = value as Partial<IRepositoryViewState>
  return (
    candidate.version === RepositoryViewStateVersion &&
    isRepositorySectionTab(candidate.selectedSection) &&
    isCommitHistoryOrder(candidate.order) &&
    Array.isArray(candidate.branches) &&
    candidate.branches.every(isBranchViewState)
  )
}

export function getRepositoryViewState(
  repository: Repository
): IRepositoryViewState {
  const storedState = getObject<unknown>(getStorageKey(repository))
  return isRepositoryViewState(storedState)
    ? storedState
    : getDefaultRepositoryViewState()
}

export function getRepositoryHistoryOrder(
  repository: Repository
): CommitHistoryOrder {
  return getRepositoryViewState(repository).order
}

export function storeRepositoryViewState(
  repository: Repository,
  state: IRepositoryViewState
): void {
  setObject(getStorageKey(repository), state)
}

export function updateRepositoryViewState(
  repository: Repository,
  update: (state: IRepositoryViewState) => IRepositoryViewState
): IRepositoryViewState {
  const newState = update(getRepositoryViewState(repository))
  storeRepositoryViewState(repository, newState)
  return newState
}

export function getBranchKey(tip: Tip): string | null {
  switch (tip.kind) {
    case TipState.Valid:
      return `branch:${tip.branch.ref}`
    case TipState.Detached:
      return `detached:${tip.currentSha}`
    case TipState.Unknown:
    case TipState.Unborn:
      return null
  }
}

export function getBranchViewState(
  repository: Repository,
  tip: Tip
): IRepositoryBranchViewState | null {
  const branchKey = getBranchKey(tip)
  if (branchKey === null) {
    return null
  }

  return (
    getRepositoryViewState(repository).branches.find(
      state => state.branchKey === branchKey
    ) ?? null
  )
}

export function storeBranchViewState(
  repository: Repository,
  tip: Tip,
  branchState: Omit<IRepositoryBranchViewState, 'branchKey'>
): void {
  const branchKey = getBranchKey(tip)
  if (branchKey === null) {
    return
  }

  updateRepositoryViewState(repository, state => ({
    ...state,
    branches: [
      ...state.branches.filter(branch => branch.branchKey !== branchKey),
      { branchKey, ...branchState },
    ],
  }))
}

export function clearCurrentBranchViewState(
  repository: Repository,
  tip: Tip
): boolean {
  const branchKey = getBranchKey(tip)
  if (branchKey === null) {
    return false
  }

  const state = getRepositoryViewState(repository)
  if (!state.branches.some(branch => branch.branchKey === branchKey)) {
    return false
  }

  storeRepositoryViewState(repository, {
    ...state,
    branches: state.branches.filter(branch => branch.branchKey !== branchKey),
  })
  return true
}

export function deleteRepositoryViewState(repository: Repository): void {
  localStorage.removeItem(getStorageKey(repository))
}
