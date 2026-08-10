import assert from 'node:assert'
import { describe, it } from 'node:test'

import { isToggleCommitReadShortcut } from '../../src/ui/history/commit-read-shortcut'

function shortcutEvent(
  overrides: Partial<Parameters<typeof isToggleCommitReadShortcut>[0]> = {}
) {
  return {
    altKey: true,
    code: 'KeyC',
    ctrlKey: false,
    metaKey: false,
    repeat: false,
    shiftKey: false,
    ...overrides,
  }
}

describe('commit read shortcut', () => {
  it('matches physical Option+C on macOS', () => {
    assert.equal(isToggleCommitReadShortcut(shortcutEvent(), true), true)
  })

  it('does not match on other platforms', () => {
    assert.equal(isToggleCommitReadShortcut(shortcutEvent(), false), false)
  })

  it('rejects repeats, other keys, and additional modifiers', () => {
    assert.equal(
      isToggleCommitReadShortcut(shortcutEvent({ repeat: true }), true),
      false
    )
    assert.equal(
      isToggleCommitReadShortcut(shortcutEvent({ code: 'KeyX' }), true),
      false
    )
    assert.equal(
      isToggleCommitReadShortcut(shortcutEvent({ metaKey: true }), true),
      false
    )
    assert.equal(
      isToggleCommitReadShortcut(shortcutEvent({ shiftKey: true }), true),
      false
    )
  })
})
