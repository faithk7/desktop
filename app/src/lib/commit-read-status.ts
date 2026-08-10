import { getStringArray, setStringArray } from './local-storage'
import { Repository } from '../models/repository'

const RepositoryCommitReadStatusStorageKeyPrefix =
  'repository-commit-read-status-v1'

function getStorageKey(repository: Repository): string {
  return `${RepositoryCommitReadStatusStorageKeyPrefix}-${repository.id}`
}

export function getRepositoryReadCommitSHAs(
  repository: Repository
): ReadonlySet<string> {
  return new Set(getStringArray(getStorageKey(repository)))
}

export function storeRepositoryReadCommitSHAs(
  repository: Repository,
  readCommitSHAs: ReadonlySet<string>
): void {
  setStringArray(getStorageKey(repository), [...readCommitSHAs])
}

export function deleteRepositoryReadCommitSHAs(repository: Repository): void {
  localStorage.removeItem(getStorageKey(repository))
}

export function toggleReadCommitSHAs(
  readCommitSHAs: ReadonlySet<string>,
  commitSHAs: ReadonlyArray<string>
): ReadonlySet<string> {
  const updatedReadCommitSHAs = new Set(readCommitSHAs)

  for (const sha of new Set(commitSHAs)) {
    if (updatedReadCommitSHAs.has(sha)) {
      updatedReadCommitSHAs.delete(sha)
    } else {
      updatedReadCommitSHAs.add(sha)
    }
  }

  return updatedReadCommitSHAs
}
