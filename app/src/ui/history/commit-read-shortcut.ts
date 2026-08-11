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
  return (
    isDarwin &&
    !event.repeat &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey &&
    event.code === 'KeyV' &&
    !isEditableTarget(event.target)
  )
}
