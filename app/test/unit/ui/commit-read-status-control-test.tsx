import assert from 'node:assert'
import { describe, it } from 'node:test'
import * as React from 'react'

import { Commit } from '../../../src/models/commit'
import { CommitIdentity } from '../../../src/models/commit-identity'
import { CommitListItem } from '../../../src/ui/history/commit-list-item'
import { fireEvent, render, screen } from '../../helpers/ui/render'

const identity = new CommitIdentity(
  'Mona Lisa',
  'mona@example.com',
  new Date('2026-08-10T00:00:00Z')
)
const commit = new Commit(
  '0123456789012345678901234567890123456789',
  '0123456',
  'Add read status',
  '',
  identity,
  identity,
  [],
  [],
  []
)

function renderCommitListItem(
  isRead: boolean,
  onToggleReadStatus?: (commit: Commit) => void,
  onClick?: () => void,
  onMouseDown?: () => void
) {
  return render(
    <div
      role="button"
      tabIndex={0}
      onKeyDown={() => {}}
      onClick={onClick}
      onMouseDown={onMouseDown}
    >
      <CommitListItem
        gitHubRepository={null}
        commit={commit}
        selectedCommits={[commit]}
        emoji={new Map()}
        showUnpushedIndicator={false}
        accounts={[]}
        preferAbsoluteDates={false}
        isRead={isRead}
        onToggleReadStatus={onToggleReadStatus}
      />
    </div>
  )
}

describe('commit read status control', () => {
  it('renders and updates the checked read state', () => {
    const view = renderCommitListItem(false, () => {})
    const checkbox = screen.getByRole('checkbox', {
      name: 'Read commit: Add read status',
    }) as HTMLInputElement

    assert.equal(checkbox.checked, false)

    view.rerender(
      <CommitListItem
        gitHubRepository={null}
        commit={commit}
        selectedCommits={[commit]}
        emoji={new Map()}
        showUnpushedIndicator={false}
        accounts={[]}
        preferAbsoluteDates={false}
        isRead={true}
        onToggleReadStatus={() => {}}
      />
    )

    const updatedCheckbox = screen.getByRole('checkbox', {
      name: 'Read commit: Add read status',
    }) as HTMLInputElement
    assert.equal(updatedCheckbox.checked, true)
  })

  it('toggles without activating the containing commit row', () => {
    let toggledCommit: Commit | null = null
    let parentClicks = 0
    let parentMouseDowns = 0
    renderCommitListItem(
      false,
      toggled => (toggledCommit = toggled),
      () => parentClicks++,
      () => parentMouseDowns++
    )

    const checkbox = screen.getByRole('checkbox', {
      name: 'Read commit: Add read status',
    })
    fireEvent.mouseDown(checkbox)
    fireEvent.click(checkbox)

    assert.equal(toggledCommit, commit)
    assert.equal(parentClicks, 0)
    assert.equal(parentMouseDowns, 0)
  })

  it('does not render the control when read status is unavailable', () => {
    renderCommitListItem(false)

    assert.equal(screen.queryByRole('checkbox'), null)
  })
})
