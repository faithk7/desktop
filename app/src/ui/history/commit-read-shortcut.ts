type CommitReadShortcutEvent = Pick<
  KeyboardEvent,
  'altKey' | 'code' | 'ctrlKey' | 'metaKey' | 'repeat' | 'shiftKey'
>

export function isToggleCommitReadShortcut(
  event: CommitReadShortcutEvent,
  isDarwin: boolean = __DARWIN__
): boolean {
  return (
    isDarwin &&
    !event.repeat &&
    event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey &&
    event.code === 'KeyC'
  )
}
