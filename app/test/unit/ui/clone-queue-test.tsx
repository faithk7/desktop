import assert from 'node:assert'
import { describe, it } from 'node:test'
import * as React from 'react'

import { ICloneQueueEntry } from '../../../src/models/clone-queue'
import { CloningRepository } from '../../../src/models/cloning-repository'
import { CloneQueue } from '../../../src/ui/explorer/clone-queue'
import { fireEvent, render, screen, waitFor } from '../../helpers/ui/render'

function activeEntry(): ICloneQueueEntry {
  const repository = new CloningRepository(
    '/tmp/github-desktop-queue',
    'https://github.com/octocat/queue.git'
  )
  return {
    id: repository.id,
    name: repository.name,
    url: repository.url,
    path: repository.path,
    options: {},
    status: 'active',
    repository,
    progress: {
      kind: 'clone',
      description: 'Receiving objects',
      value: 0.42,
    },
    error: null,
  }
}

function failedEntry(): ICloneQueueEntry {
  const entry = activeEntry()
  return {
    ...entry,
    id: entry.id + 1,
    status: 'failed',
    repository: null,
    progress: null,
    error: 'The remote repository could not be reached.',
  }
}

describe('CloneQueue', () => {
  it('shows active progress and exposes cancellation', async () => {
    const entry = activeEntry()
    let cancelled = false

    function Harness() {
      const [isOpen, setOpen] = React.useState(false)
      return (
        <CloneQueue
          entries={[entry]}
          isOpen={isOpen}
          onToggle={() => setOpen(value => !value)}
          onClose={() => setOpen(false)}
          onCancel={() => {
            cancelled = true
          }}
          onRetry={() => {}}
          onChooseLocation={() => {}}
          onDismiss={() => {}}
        />
      )
    }

    render(<Harness />)
    const trigger = screen.getByRole('button', { name: /Background downloads/ })
    assert.equal(trigger.getAttribute('aria-expanded'), 'false')
    fireEvent.click(trigger)

    await waitFor(() => assert.ok(screen.getByText('queue')))
    assert.ok(screen.getByText('Receiving objects'))
    assert.ok(screen.getByText('42%'))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    assert.equal(cancelled, true)
  })

  it('shows retry actions for failed jobs', async () => {
    const entry = failedEntry()
    const actions: string[] = []

    render(
      <CloneQueue
        entries={[entry]}
        isOpen={true}
        onToggle={() => {}}
        onClose={() => {}}
        onCancel={() => {}}
        onRetry={() => actions.push('retry')}
        onChooseLocation={() => actions.push('location')}
        onDismiss={() => actions.push('dismiss')}
      />
    )

    await waitFor(() =>
      assert.ok(screen.getByText('The remote repository could not be reached.'))
    )
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    fireEvent.click(screen.getByRole('button', { name: 'Choose location…' }))
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    assert.deepEqual(actions, ['retry', 'location', 'dismiss'])
  })
})
