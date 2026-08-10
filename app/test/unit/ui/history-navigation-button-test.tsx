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

  it('keeps the button footprint active while suppressing duplicate loads', () => {
    let loadAllCount = 0

    const view = render(
      <HistoryNavigationButton
        isLoading={false}
        canGoToSelectedCommit={true}
        onLoadAllAndGoToBottom={() => loadAllCount++}
        onGoToSelectedCommit={() => {}}
      />
    )

    view.rerender(
      <HistoryNavigationButton
        isLoading={true}
        canGoToSelectedCommit={true}
        onLoadAllAndGoToBottom={() => loadAllCount++}
        onGoToSelectedCommit={() => {}}
      />
    )

    const button = screen.getByRole('button', {
      name: 'Loading commit history…',
    })

    assert.notEqual(button.querySelector('.spin'), null)
    fireEvent.click(button)
    assert.equal(loadAllCount, 0)
  })

  it('builds two menu actions with loading and selection availability', () => {
    let loadAllCount = 0
    let goToSelectionCount = 0

    const items = getHistoryNavigationMenuItems(
      true,
      true,
      () => loadAllCount++,
      () => goToSelectionCount++
    )

    assert.equal(items.length, 2)
    assert.match(items[0].label ?? '', /Load [Aa]ll and [Gg]o to [Bb]ottom/)
    assert.equal(items[0].enabled, false)
    assert.match(items[1].label ?? '', /Go to [Ss]elected [Cc]ommit/)
    assert.equal(items[1].enabled, true)

    items[0].action?.()
    items[1].action?.()
    assert.equal(loadAllCount, 1)
    assert.equal(goToSelectionCount, 1)
  })
})
