import assert from 'node:assert'
import { describe, it } from 'node:test'

import {
  isToggleCommitBookmarkShortcut,
  isToggleCommitReadShortcut,
} from '../../src/ui/history/commit-read-shortcut'

function shortcutEvent(
  overrides: Partial<Parameters<typeof isToggleCommitReadShortcut>[0]> = {}
) {
  return {
    altKey: false,
    code: 'KeyV',
    ctrlKey: false,
    metaKey: false,
    repeat: false,
    shiftKey: false,
    target: null,
    ...overrides,
  }
}

describe('commit read shortcut', () => {
  it('matches physical V on macOS', () => {
    assert.equal(isToggleCommitReadShortcut(shortcutEvent(), true), true)
  })

  it('does not match on other platforms', () => {
    assert.equal(isToggleCommitReadShortcut(shortcutEvent(), false), false)
  })

  it('rejects repeats, other keys, and modifiers', () => {
    assert.equal(
      isToggleCommitReadShortcut(shortcutEvent({ repeat: true }), true),
      false
    )
    assert.equal(
      isToggleCommitReadShortcut(shortcutEvent({ code: 'KeyX' }), true),
      false
    )
    assert.equal(
      isToggleCommitReadShortcut(shortcutEvent({ altKey: true }), true),
      false
    )
    assert.equal(
      isToggleCommitReadShortcut(
        shortcutEvent({ altKey: true, code: 'KeyC' }),
        true
      ),
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

  it('does not match while editing text or selecting an option', () => {
    for (const tagName of ['input', 'textarea', 'select']) {
      assert.equal(
        isToggleCommitReadShortcut(
          shortcutEvent({ target: document.createElement(tagName) }),
          true
        ),
        false
      )
    }

    const editable = document.createElement('div')
    editable.setAttribute('contenteditable', 'true')
    const editableChild = document.createElement('span')
    editable.appendChild(editableChild)

    assert.equal(
      isToggleCommitReadShortcut(
        shortcutEvent({ target: editableChild }),
        true
      ),
      false
    )
  })
})

describe('commit bookmark shortcut', () => {
  it('matches physical B on macOS', () => {
    assert.equal(
      isToggleCommitBookmarkShortcut(shortcutEvent({ code: 'KeyB' }), true),
      true
    )
  })

  it('does not match on other platforms or with modifiers', () => {
    assert.equal(
      isToggleCommitBookmarkShortcut(shortcutEvent({ code: 'KeyB' }), false),
      false
    )
    assert.equal(
      isToggleCommitBookmarkShortcut(
        shortcutEvent({ code: 'KeyB', metaKey: true }),
        true
      ),
      false
    )
  })
})
