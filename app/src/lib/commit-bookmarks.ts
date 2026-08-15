import { getStringArray, setStringArray } from './local-storage'
import { Repository } from '../models/repository'

const RepositoryCommitBookmarksStorageKeyPrefix =
  'repository-commit-bookmarks-v1'

function getStorageKey(repository: Repository): string {
  return `${RepositoryCommitBookmarksStorageKeyPrefix}-${repository.id}`
}

export function getRepositoryBookmarkedCommitSHAs(
  repository: Repository
): ReadonlySet<string> {
  return new Set(getStringArray(getStorageKey(repository)))
}

export function storeRepositoryBookmarkedCommitSHAs(
  repository: Repository,
  bookmarkedCommitSHAs: ReadonlySet<string>
): void {
  setStringArray(getStorageKey(repository), [...bookmarkedCommitSHAs])
}

export function deleteRepositoryBookmarkedCommitSHAs(
  repository: Repository
): void {
  localStorage.removeItem(getStorageKey(repository))
}

export function toggleBookmarkedCommitSHAs(
  bookmarkedCommitSHAs: ReadonlySet<string>,
  commitSHAs: ReadonlyArray<string>
): ReadonlySet<string> {
  const updatedBookmarkedCommitSHAs = new Set(bookmarkedCommitSHAs)

  for (const sha of new Set(commitSHAs)) {
    if (updatedBookmarkedCommitSHAs.has(sha)) {
      updatedBookmarkedCommitSHAs.delete(sha)
    } else {
      updatedBookmarkedCommitSHAs.add(sha)
    }
  }

  return updatedBookmarkedCommitSHAs
}
