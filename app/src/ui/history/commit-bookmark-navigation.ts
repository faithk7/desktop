export type BookmarkedCommitNavigationDirection = 'previous' | 'next'

/**
 * Finds the next loaded bookmarked commit in the order shown in the history
 * list. Navigation wraps at either end of the loaded commits.
 */
export function getBookmarkedCommitNavigationTarget(
  displayCommitSHAs: ReadonlyArray<string>,
  selectedCommitSHAs: ReadonlyArray<string>,
  bookmarkedCommitSHAs: ReadonlySet<string>,
  direction: BookmarkedCommitNavigationDirection
): string | undefined {
  const bookmarkedRows = displayCommitSHAs
    .map((sha, row) => (bookmarkedCommitSHAs.has(sha) ? row : undefined))
    .filter((row): row is number => row !== undefined)

  if (bookmarkedRows.length === 0) {
    return undefined
  }

  const rowBySHA = new Map(displayCommitSHAs.map((sha, row) => [sha, row]))
  const selectedRows = selectedCommitSHAs
    .map(sha => rowBySHA.get(sha))
    .filter((row): row is number => row !== undefined)

  let targetRow: number
  if (selectedRows.length === 0) {
    targetRow =
      direction === 'previous'
        ? bookmarkedRows[bookmarkedRows.length - 1]
        : bookmarkedRows[0]
  } else if (direction === 'previous') {
    const firstSelectedRow = Math.min(...selectedRows)
    targetRow =
      bookmarkedRows.findLast(row => row < firstSelectedRow) ??
      bookmarkedRows[bookmarkedRows.length - 1]
  } else {
    const lastSelectedRow = Math.max(...selectedRows)
    targetRow =
      bookmarkedRows.find(row => row > lastSelectedRow) ?? bookmarkedRows[0]
  }

  const targetSHA = displayCommitSHAs[targetRow]
  return selectedCommitSHAs.length === 1 && targetSHA === selectedCommitSHAs[0]
    ? undefined
    : targetSHA
}
