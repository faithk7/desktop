import assert from 'node:assert'
import { describe, it } from 'node:test'
import * as React from 'react'

import {
  getHistoryNavigationMenuItems,
  HistoryNavigationButton,
} from '../../../src/ui/history/history-navigation-button'
import { fireEvent, render, screen } from '../../helpers/ui/render'

describe('HistoryNavigationButton', () => {
  it('runs the primary action and exposes its menu relationship', () => {
    let loadAllCount = 0

    render(
      <HistoryNavigationButton
        isLoading={false}
        canGoToSelectedCommit={true}
        onLoadAllAndGoToBottom={() => loadAllCount++}
        onCancelLoadAllCommits={() => {}}
        onGoToTop={() => {}}
        onGoToSelectedCommit={() => {}}
      />
    )

    const button = screen.getByRole('button', {
      name: 'Load all commits and go to bottom. Right-click for more options.',
    })

    assert.equal(button.getAttribute('aria-haspopup'), 'menu')
    fireEvent.click(button)
    assert.equal(loadAllCount, 1)
  })

  it('stops loading in place when the active button is clicked', () => {
    let loadAllCount = 0
    let cancelCount = 0

    const view = render(
      <HistoryNavigationButton
        isLoading={false}
        canGoToSelectedCommit={true}
        onLoadAllAndGoToBottom={() => loadAllCount++}
        onCancelLoadAllCommits={() => cancelCount++}
        onGoToTop={() => {}}
        onGoToSelectedCommit={() => {}}
      />
    )

    view.rerender(
      <HistoryNavigationButton
        isLoading={true}
        canGoToSelectedCommit={true}
        onLoadAllAndGoToBottom={() => loadAllCount++}
        onCancelLoadAllCommits={() => cancelCount++}
        onGoToTop={() => {}}
        onGoToSelectedCommit={() => {}}
      />
    )

    const button = screen.getByRole('button', {
      name: 'Stop loading commit history and stay here.',
    })

    assert.notEqual(button.querySelector('.spin'), null)
    fireEvent.click(button)
    assert.equal(loadAllCount, 0)
    assert.equal(cancelCount, 1)
  })

  it('builds stop, top, and selected commit menu actions while loading', () => {
    let loadAllCount = 0
    let cancelCount = 0
    let goToTopCount = 0
    let goToSelectionCount = 0

    const items = getHistoryNavigationMenuItems(
      true,
      true,
      () => loadAllCount++,
      () => cancelCount++,
      () => goToTopCount++,
      () => goToSelectionCount++
    )

    assert.equal(items.length, 3)
    assert.match(items[0].label ?? '', /Stop [Hh]ere/)
    assert.equal(items[0].enabled, true)
    assert.match(items[1].label ?? '', /Go to [Tt]op/)
    assert.equal(items[1].enabled, true)
    assert.match(items[2].label ?? '', /Go to [Ss]elected [Cc]ommit/)
    assert.equal(items[2].enabled, true)

    items[0].action?.()
    items[1].action?.()
    items[2].action?.()
    assert.equal(loadAllCount, 0)
    assert.equal(cancelCount, 1)
    assert.equal(goToTopCount, 1)
    assert.equal(goToSelectionCount, 1)
  })

  it('keeps the load-all action available while idle', () => {
    let loadAllCount = 0

    const items = getHistoryNavigationMenuItems(
      false,
      false,
      () => loadAllCount++,
      () => {},
      () => {},
      () => {}
    )

    assert.match(items[0].label ?? '', /Load [Aa]ll and [Gg]o to [Bb]ottom/)
    assert.equal(items[0].enabled, true)
    assert.equal(items[2].enabled, false)
    items[0].action?.()
    assert.equal(loadAllCount, 1)
  })
})
