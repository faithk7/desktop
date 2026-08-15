import * as React from 'react'
import { ICloneQueueEntry } from '../../models/clone-queue'
import * as octicons from '../octicons/octicons.generated'
import { Octicon } from '../octicons'
import { Button } from '../lib/button'
import {
  Popover,
  PopoverAnchorPosition,
  PopoverDecoration,
} from '../lib/popover'

interface ICloneQueueProps {
  readonly entries: ReadonlyArray<ICloneQueueEntry>
  readonly isOpen: boolean
  readonly onToggle: () => void
  readonly onClose: () => void
  readonly onCancel: (entry: ICloneQueueEntry) => void
  readonly onRetry: (entry: ICloneQueueEntry) => void
  readonly onChooseLocation: (entry: ICloneQueueEntry) => void
  readonly onDismiss: (entry: ICloneQueueEntry) => void
}

export class CloneQueue extends React.Component<ICloneQueueProps> {
  private button: HTMLButtonElement | null = null

  private onButtonRef = (button: HTMLButtonElement | null) => {
    this.button = button
  }

  private findEntry = (id: string): ICloneQueueEntry | null => {
    const entry = this.props.entries.find(value => value.id === Number(id))
    return entry ?? null
  }

  private onCancelClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    const entry = this.findEntry(event.currentTarget.id)
    if (entry !== null) {
      this.props.onCancel(entry)
    }
  }

  private onRetryClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    const entry = this.findEntry(event.currentTarget.id)
    if (entry !== null) {
      this.props.onRetry(entry)
    }
  }

  private onChooseLocationClick = (
    event: React.MouseEvent<HTMLButtonElement>
  ) => {
    const entry = this.findEntry(event.currentTarget.id)
    if (entry !== null) {
      this.props.onChooseLocation(entry)
    }
  }

  private onDismissClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    const entry = this.findEntry(event.currentTarget.id)
    if (entry !== null) {
      this.props.onDismiss(entry)
    }
  }

  private onCloseClick = () => {
    this.props.onClose()
  }

  private renderProgress(entry: ICloneQueueEntry) {
    const progress = entry.progress
    const value = progress?.value ?? 0

    return (
      <div className="explorer-clone-queue-progress">
        <div className="explorer-clone-queue-progress-label">
          <span>{progress?.description ?? 'Starting clone…'}</span>
          <span>{Math.round(value * 100)}%</span>
        </div>
        <div className="explorer-clone-queue-progress-track">
          <div style={{ transform: `scaleX(${Math.max(value, 0.04)})` }} />
        </div>
      </div>
    )
  }

  private renderActiveEntry = (entry: ICloneQueueEntry) => (
    <li className="explorer-clone-queue-entry" key={entry.id}>
      <div className="explorer-clone-queue-entry-heading">
        <Octicon symbol={octicons.repoClone} />
        <strong>{entry.name}</strong>
      </div>
      <span className="explorer-clone-queue-path">{entry.path}</span>
      {this.renderProgress(entry)}
      <Button
        size="small"
        id={String(entry.id)}
        className="explorer-clone-queue-action"
        onClick={this.onCancelClick}
      >
        Cancel
      </Button>
    </li>
  )

  private renderFailedEntry = (entry: ICloneQueueEntry) => (
    <li
      className="explorer-clone-queue-entry explorer-clone-queue-entry-failed"
      key={entry.id}
    >
      <div className="explorer-clone-queue-entry-heading">
        <Octicon symbol={octicons.alert} />
        <strong>{entry.name}</strong>
      </div>
      <span className="explorer-clone-queue-path">{entry.path}</span>
      <p className="explorer-clone-queue-error">
        {entry.error ?? 'Clone failed. Check your connection and try again.'}
      </p>
      <div className="explorer-clone-queue-actions">
        <Button size="small" id={String(entry.id)} onClick={this.onRetryClick}>
          Retry
        </Button>
        <Button
          size="small"
          id={String(entry.id)}
          onClick={this.onChooseLocationClick}
        >
          Choose location…
        </Button>
        <Button
          size="small"
          id={String(entry.id)}
          onClick={this.onDismissClick}
        >
          Dismiss
        </Button>
      </div>
    </li>
  )

  private renderPopover() {
    const activeEntries = this.props.entries.filter(
      entry => entry.status === 'active'
    )
    const failedEntries = this.props.entries.filter(
      entry => entry.status === 'failed'
    )

    return (
      <Popover
        anchor={this.button}
        anchorPosition={PopoverAnchorPosition.BottomRight}
        decoration={PopoverDecoration.Balloon}
        className="explorer-clone-queue-popover"
        ariaLabelledby="explorer-clone-queue-header"
        onMousedownOutside={this.props.onClose}
        onClickOutside={this.props.onClose}
      >
        <div className="explorer-clone-queue-header">
          <h3 id="explorer-clone-queue-header">Clone queue</h3>
          <span>{this.props.entries.length}</span>
        </div>
        {activeEntries.length > 0 && (
          <section aria-labelledby="explorer-clone-queue-active-header">
            <h4 id="explorer-clone-queue-active-header">Downloading</h4>
            <ul>{activeEntries.map(this.renderActiveEntry)}</ul>
          </section>
        )}
        {failedEntries.length > 0 && (
          <section aria-labelledby="explorer-clone-queue-failed-header">
            <h4 id="explorer-clone-queue-failed-header">Needs attention</h4>
            <ul>{failedEntries.map(this.renderFailedEntry)}</ul>
          </section>
        )}
        {this.props.entries.length === 0 && (
          <div className="explorer-clone-queue-empty">
            <p>No background clones.</p>
            <Button size="small" onClick={this.onCloseClick}>
              Close
            </Button>
          </div>
        )}
      </Popover>
    )
  }

  public render() {
    const activeCount = this.props.entries.filter(
      entry => entry.status === 'active'
    ).length

    return (
      <div className="explorer-clone-queue">
        <Button
          className="explorer-clone-queue-button"
          ariaLabel={`Background downloads${
            activeCount > 0 ? `, ${activeCount} active` : ''
          }`}
          ariaExpanded={this.props.isOpen}
          ariaHaspopup="dialog"
          tooltip="Background clone queue"
          onButtonRef={this.onButtonRef}
          onClick={this.props.onToggle}
        >
          <Octicon symbol={octicons.stack} />
          {activeCount > 0 && (
            <span className="explorer-clone-queue-count" aria-hidden="true">
              {activeCount}
            </span>
          )}
        </Button>
        {this.props.isOpen && this.renderPopover()}
      </div>
    )
  }
}
