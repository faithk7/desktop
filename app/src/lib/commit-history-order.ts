import { CommitHistoryOrder } from './app-state'
import { getEnum } from './local-storage'

export const commitHistoryOrderStorageKey = 'commit-history-order-v1'

export function getCommitHistoryOrder(): CommitHistoryOrder {
  return (
    getEnum(commitHistoryOrderStorageKey, CommitHistoryOrder) ??
    CommitHistoryOrder.NewestFirst
  )
}

export function setCommitHistoryOrder(order: CommitHistoryOrder): void {
  localStorage.setItem(commitHistoryOrderStorageKey, order)
}
