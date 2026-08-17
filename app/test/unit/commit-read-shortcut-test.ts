import assert from 'node:assert'
import { describe, it } from 'node:test'

import {
  getBookmarkedCommitNavigationDirection,
  isToggleCommitBookmarkShortcut,
  isToggleCommitReadShortcut,
} from '../../src/ui/history/commit-read-shortcut'
import { getBookmarkedCommitNavigationTarget } from '../../src/ui/history/commit-bookmark-navigation'

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

describe('bookmarked commit navigation shortcut', () => {
  it('maps physical Shift+W and Shift+S on macOS', () => {
    assert.equal(
      getBookmarkedCommitNavigationDirection(
        shortcutEvent({ code: 'KeyW', shiftKey: true }),
        true
      ),
      'previous'
    )
    assert.equal(
      getBookmarkedCommitNavigationDirection(
        shortcutEvent({ code: 'KeyS', shiftKey: true }),
        true
      ),
      'next'
    )
  })

  it('rejects other platforms, missing Shift, repeats, and other modifiers', () => {
    const event = shortcutEvent({ code: 'KeyW', shiftKey: true })

    assert.equal(getBookmarkedCommitNavigationDirection(event, false), null)
    assert.equal(
      getBookmarkedCommitNavigationDirection(
        shortcutEvent({ code: 'KeyW' }),
        true
      ),
      null
    )
    assert.equal(
      getBookmarkedCommitNavigationDirection({ ...event, repeat: true }, true),
      null
    )
    assert.equal(
      getBookmarkedCommitNavigationDirection({ ...event, altKey: true }, true),
      null
    )
    assert.equal(
      getBookmarkedCommitNavigationDirection({ ...event, ctrlKey: true }, true),
      null
    )
    assert.equal(
      getBookmarkedCommitNavigationDirection({ ...event, metaKey: true }, true),
      null
    )
  })

  it('does not match while editing text', () => {
    assert.equal(
      getBookmarkedCommitNavigationDirection(
        shortcutEvent({
          code: 'KeyS',
          shiftKey: true,
          target: document.createElement('input'),
        }),
        true
      ),
      null
    )
  })
})

describe('bookmarked commit navigation target', () => {
  const displayCommitSHAs = ['a', 'b', 'c', 'd', 'e']
  const bookmarks = new Set(['a', 'c', 'e'])

  it('finds the nearest bookmark in either visible direction', () => {
    assert.equal(
      getBookmarkedCommitNavigationTarget(
        displayCommitSHAs,
        ['d'],
        bookmarks,
        'previous'
      ),
      'c'
    )
    assert.equal(
      getBookmarkedCommitNavigationTarget(
        displayCommitSHAs,
        ['b'],
        bookmarks,
        'next'
      ),
      'c'
    )
  })

  it('wraps at both ends of the loaded history', () => {
    assert.equal(
      getBookmarkedCommitNavigationTarget(
        displayCommitSHAs,
        ['a'],
        bookmarks,
        'previous'
      ),
      'e'
    )
    assert.equal(
      getBookmarkedCommitNavigationTarget(
        displayCommitSHAs,
        ['e'],
        bookmarks,
        'next'
      ),
      'a'
    )
  })

  it('uses the visible order supplied by the caller', () => {
    const reversed = [...displayCommitSHAs].reverse()

    assert.equal(
      getBookmarkedCommitNavigationTarget(reversed, ['c'], bookmarks, 'next'),
      'a'
    )
    assert.equal(
      getBookmarkedCommitNavigationTarget(
        reversed,
        ['c'],
        bookmarks,
        'previous'
      ),
      'e'
    )
  })

  it('starts at the corresponding end when nothing is selected', () => {
    assert.equal(
      getBookmarkedCommitNavigationTarget(
        displayCommitSHAs,
        [],
        bookmarks,
        'next'
      ),
      'a'
    )
    assert.equal(
      getBookmarkedCommitNavigationTarget(
        displayCommitSHAs,
        [],
        bookmarks,
        'previous'
      ),
      'e'
    )
  })

  it('navigates beyond the appropriate edge of a multi-selection', () => {
    assert.equal(
      getBookmarkedCommitNavigationTarget(
        displayCommitSHAs,
        ['b', 'c', 'd'],
        bookmarks,
        'previous'
      ),
      'a'
    )
    assert.equal(
      getBookmarkedCommitNavigationTarget(
        displayCommitSHAs,
        ['b', 'c', 'd'],
        bookmarks,
        'next'
      ),
      'e'
    )
  })

  it('ignores bookmarks that are not currently loaded', () => {
    assert.equal(
      getBookmarkedCommitNavigationTarget(
        displayCommitSHAs,
        ['b'],
        new Set(['unloaded']),
        'next'
      ),
      undefined
    )
  })

  it('does not navigate back to the only selected loaded bookmark', () => {
    assert.equal(
      getBookmarkedCommitNavigationTarget(
        displayCommitSHAs,
        ['c'],
        new Set(['c', 'unloaded']),
        'next'
      ),
      undefined
    )
  })
})
