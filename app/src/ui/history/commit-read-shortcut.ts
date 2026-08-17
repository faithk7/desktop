import { BookmarkedCommitNavigationDirection } from './commit-bookmark-navigation'

type CommitReadShortcutEvent = Pick<
  KeyboardEvent,
  'altKey' | 'code' | 'ctrlKey' | 'metaKey' | 'repeat' | 'shiftKey' | 'target'
>

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.matches('input, textarea, select') ||
      target.isContentEditable ||
      target.closest('[contenteditable]:not([contenteditable="false"])') !==
        null)
  )
}

export function isToggleCommitReadShortcut(
  event: CommitReadShortcutEvent,
  isDarwin: boolean = __DARWIN__
): boolean {
  return isToggleCommitShortcut(event, 'KeyV', isDarwin)
}

export function isToggleCommitBookmarkShortcut(
  event: CommitReadShortcutEvent,
  isDarwin: boolean = __DARWIN__
): boolean {
  return isToggleCommitShortcut(event, 'KeyB', isDarwin)
}

export function getBookmarkedCommitNavigationDirection(
  event: CommitReadShortcutEvent,
  isDarwin: boolean = __DARWIN__
): BookmarkedCommitNavigationDirection | null {
  if (
    !isDarwin ||
    event.repeat ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    !event.shiftKey ||
    isEditableTarget(event.target)
  ) {
    return null
  }

  switch (event.code) {
    case 'KeyW':
      return 'previous'
    case 'KeyS':
      return 'next'
    default:
      return null
  }
}

function isToggleCommitShortcut(
  event: CommitReadShortcutEvent,
  code: 'KeyB' | 'KeyV',
  isDarwin: boolean
): boolean {
  return (
    isDarwin &&
    !event.repeat &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey &&
    event.code === code &&
    !isEditableTarget(event.target)
  )
}
