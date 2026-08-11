import * as React from 'react'

import { IMenuItem, showContextualMenu } from '../../lib/menu-item'
import { Button } from '../lib/button'
import { Loading } from '../lib/loading'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'

interface IHistoryNavigationButtonProps {
  readonly isLoading: boolean
  readonly canGoToSelectedCommit: boolean
  readonly onLoadAllAndGoToBottom: () => void
  readonly onCancelLoadAllCommits: () => void
  readonly onGoToTop: () => void
  readonly onGoToSelectedCommit: () => void
}

export function getHistoryNavigationMenuItems(
  isLoading: boolean,
  canGoToSelectedCommit: boolean,
  onLoadAllAndGoToBottom: () => void,
  onCancelLoadAllCommits: () => void,
  onGoToTop: () => void,
  onGoToSelectedCommit: () => void
): ReadonlyArray<IMenuItem> {
  return [
    {
      label: isLoading
        ? __DARWIN__
          ? 'Stop Here'
          : 'Stop here'
        : __DARWIN__
        ? 'Load All and Go to Bottom'
        : 'Load all and go to bottom',
      enabled: true,
      action: isLoading ? onCancelLoadAllCommits : onLoadAllAndGoToBottom,
    },
    {
      label: __DARWIN__ ? 'Go to Top' : 'Go to top',
      enabled: true,
      action: onGoToTop,
    },
    {
      label: __DARWIN__ ? 'Go to Selected Commit' : 'Go to selected commit',
      enabled: canGoToSelectedCommit,
      action: onGoToSelectedCommit,
    },
  ]
}

export class HistoryNavigationButton extends React.PureComponent<IHistoryNavigationButtonProps> {
  private showMenu = () => {
    showContextualMenu(
      getHistoryNavigationMenuItems(
        this.props.isLoading,
        this.props.canGoToSelectedCommit,
        this.props.onLoadAllAndGoToBottom,
        this.props.onCancelLoadAllCommits,
        this.props.onGoToTop,
        this.props.onGoToSelectedCommit
      )
    )
  }

  private onClick = () => {
    if (this.props.isLoading) {
      this.props.onCancelLoadAllCommits()
    } else {
      this.props.onLoadAllAndGoToBottom()
    }
  }

  private onContextMenu = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    this.showMenu()
  }

  private onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      this.showMenu()
    }
  }

  public render() {
    const label = this.props.isLoading
      ? 'Stop loading commit history and stay here.'
      : 'Load all commits and go to bottom. Right-click for more options.'

    return (
      <Button
        className="history-navigation-button"
        ariaHaspopup="menu"
        ariaLabel={label}
        tooltip={label}
        applyTooltipAriaDescribedBy={false}
        onClick={this.onClick}
        onContextMenu={this.onContextMenu}
        onKeyDown={this.onKeyDown}
      >
        {this.props.isLoading ? (
          <Loading />
        ) : (
          <Octicon symbol={octicons.moveToBottom} />
        )}
      </Button>
    )
  }
}
