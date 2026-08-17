import * as React from 'react'

import { Commit, CommitOneLine, ICommitContext } from '../../models/commit'
import {
  CommitHistoryOrder,
  HistoryTabMode,
  ICompareState,
  ICompareBranch,
  ComparisonMode,
  IDisplayHistory,
} from '../../lib/app-state'
import { CommitList } from './commit-list'
import { Repository } from '../../models/repository'
import { Branch } from '../../models/branch'
import { defaultErrorHandler, Dispatcher } from '../dispatcher'
import { ThrottledScheduler } from '../lib/throttled-scheduler'
import { BranchList } from '../branches'
import { TextBox } from '../lib/text-box'
import { IBranchListItem } from '../branches/group-branches'
import { TabBar } from '../tab-bar'
import { CompareBranchListItem } from './compare-branch-list-item'
import { FancyTextBox } from '../lib/fancy-text-box'
import * as octicons from '../octicons/octicons.generated'
import { Octicon } from '../octicons'
import { SelectionSource } from '../lib/filter-list'
import { IMatches } from '../../lib/fuzzy-find'
import { Ref } from '../lib/ref'
import { MergeCallToActionWithConflicts } from './merge-call-to-action-with-conflicts'
import { AheadBehindStore } from '../../lib/stores/ahead-behind-store'
import { DragType } from '../../models/drag-drop'
import { PopupType } from '../../models/popup'
import { getUniqueCoauthorsAsAuthors } from '../../lib/unique-coauthors-as-authors'
import { getSquashedCommitDescription } from '../../lib/squash/squashed-commit-description'
import { doMergeCommitsExistAfterCommit } from '../../lib/git'
import { KeyboardInsertionData } from '../lib/list'
import { Account } from '../../models/account'
import { Emoji } from '../../lib/emoji'
import { formatNumber } from '../../lib/format-number'
import { getRepositoryHistoryOrder } from '../../lib/repository-view-state'
import { Button } from '../lib/button'
import { AriaLiveContainer } from '../accessibility/aria-live-container'
import { IMenuItem, showContextualMenu } from '../../lib/menu-item'
import {
  BookmarkedCommitNavigationDirection,
  getBookmarkedCommitNavigationTarget,
} from './commit-bookmark-navigation'

interface ICompareSidebarProps {
  readonly repository: Repository
  readonly isLocalRepository: boolean
  readonly compareState: ICompareState
  readonly emoji: Map<string, Emoji>
  readonly commitLookup: Map<string, Commit>
  readonly localCommitSHAs: ReadonlyArray<string>
  readonly askForConfirmationOnCheckoutCommit: boolean
  readonly dispatcher: Dispatcher
  readonly currentBranch: Branch | null
  readonly selectedCommitShas: ReadonlyArray<string>
  readonly onRevertCommit: (commit: Commit) => void
  readonly onAmendCommit: (commit: Commit, isLocalCommit: boolean) => void
  readonly onViewCommitOnGitHub: (sha: string) => void
  readonly onCompareListScrolled: (scrollTop: number) => void
  readonly onCherryPick: (
    repository: Repository,
    commits: ReadonlyArray<CommitOneLine>
  ) => void
  readonly compareListScrollTop?: number
  readonly localTags: Map<string, string> | null
  readonly tagsToPush: ReadonlyArray<string> | null
  readonly aheadBehindStore: AheadBehindStore
  readonly isMultiCommitOperationInProgress?: boolean
  readonly shasToHighlight: ReadonlyArray<string>
  readonly accounts: ReadonlyArray<Account>
  readonly preferAbsoluteDates: boolean
  readonly readCommitSHAs: ReadonlySet<string>
  readonly bookmarkedCommitSHAs: ReadonlySet<string>
}
interface ICompareSidebarState {
  /**
   * This branch should only be used when tracking interactions that the user is performing.
   *
   * For all other cases, use the prop
   */
  readonly focusedBranch: Branch | null

  /** Data to be reordered via keyboard */
  readonly keyboardReorderData?: KeyboardInsertionData

  /** Whether the commit history is being reloaded in a different order. */
  readonly isChangingHistoryOrder: boolean

  /** Whether all remaining commits are being loaded and followed. */
  readonly isLoadingAllCommits: boolean

  /** History status update announced to screen reader users. */
  readonly historyStatusMessage: string

  /** Forces repeated history status messages to be announced. */
  readonly historyStatusChangeSignal: boolean
}

/** If we're within this many rows from the bottom, load the next history batch. */
const CloseToBottomThreshold = 10

/** Maximum time to automatically load and follow commit history. */
export const LoadAllCommitsTimeout = 10 * 60 * 1000

export class CompareSidebar extends React.Component<
  ICompareSidebarProps,
  ICompareSidebarState
> {
  private textbox: TextBox | null = null
  private readonly loadChangedFilesScheduler = new ThrottledScheduler(200)
  private branchList: BranchList | null = null
  private commitListRef = React.createRef<CommitList>()
  private loadingMoreCommitsPromise: Promise<boolean> | null = null
  private isLoadingAllCommits = false
  private loadAllGeneration = 0
  private loadAllTimeoutID: number | null = null
  private isUnmounted = false
  private commitCountWaiter: {
    readonly previousCount: number
    readonly generation: number
    readonly resolve: () => void
  } | null = null
  private resultCount = 0

  public constructor(props: ICompareSidebarProps) {
    super(props)

    this.state = {
      focusedBranch: null,
      isChangingHistoryOrder: false,
      isLoadingAllCommits: false,
      historyStatusMessage: '',
      historyStatusChangeSignal: false,
    }
  }

  public componentWillReceiveProps(nextProps: ICompareSidebarProps) {
    const newFormState = nextProps.compareState.formState
    const oldFormState = this.props.compareState.formState

    if (
      newFormState.kind !== oldFormState.kind &&
      newFormState.kind === HistoryTabMode.History
    ) {
      this.setState({
        focusedBranch: null,
      })
      return
    }

    if (
      newFormState.kind !== HistoryTabMode.History &&
      oldFormState.kind !== HistoryTabMode.History
    ) {
      const oldBranch = oldFormState.comparisonBranch
      const newBranch = newFormState.comparisonBranch

      if (oldBranch.name !== newBranch.name) {
        // ensure the focused branch is in sync with the chosen branch
        this.setState({
          focusedBranch: newBranch,
        })
      }
    }
  }

  public componentDidUpdate(prevProps: ICompareSidebarProps) {
    const previousFormState = prevProps.compareState.formState
    const formState = this.props.compareState.formState
    const didHistoryOrderChange =
      previousFormState.kind === HistoryTabMode.History &&
      formState.kind === HistoryTabMode.History &&
      previousFormState.order !== formState.order

    if (
      this.isLoadingAllCommits &&
      (prevProps.repository !== this.props.repository ||
        !this.isHistoryView() ||
        didHistoryOrderChange)
    ) {
      this.cancelLoadAllCommits()
    }

    const previousCommitCount = prevProps.compareState.commitSHAs.length
    const commitCount = this.props.compareState.commitSHAs.length

    if (commitCount > previousCommitCount && this.isLoadingAllCommits) {
      this.commitListRef.current?.scrollToBottom()
    }

    const waiter = this.commitCountWaiter
    if (
      waiter !== null &&
      waiter.generation === this.loadAllGeneration &&
      commitCount > waiter.previousCount
    ) {
      this.commitCountWaiter = null
      waiter.resolve()
    }

    const { showBranchList } = this.props.compareState

    if (showBranchList === prevProps.compareState.showBranchList) {
      return
    }

    if (this.textbox !== null) {
      if (showBranchList) {
        this.textbox.focus()
      } else if (!showBranchList) {
        this.textbox.blur()
      }
    }
  }

  public focusHistory() {
    this.commitListRef.current?.focus()
  }

  public componentWillMount() {
    this.props.dispatcher.initializeCompare(this.props.repository)
  }

  public componentWillUnmount() {
    this.isUnmounted = true
    this.cancelLoadAllCommits(false)
    this.textbox = null

    // by hiding the branch list here when the component is torn down
    // we ensure any ahead/behind computation work is discarded
    this.props.dispatcher.updateCompareForm(this.props.repository, {
      showBranchList: false,
    })
  }

  public render() {
    const { branches, filterText, showBranchList } = this.props.compareState
    const placeholderText = getPlaceholderText(this.props.compareState)

    return (
      <div id="compare-view" role="tabpanel" aria-labelledby="history-tab">
        <div className="compare-form">
          <FancyTextBox
            ariaLabel="Branch filter"
            symbol={octicons.gitBranch}
            displayClearButton={true}
            placeholder={placeholderText}
            onFocus={this.onTextBoxFocused}
            value={filterText}
            disabled={!branches.some(b => !b.isDesktopForkRemoteBranch)}
            onRef={this.onTextBoxRef}
            onValueChanged={this.onBranchFilterTextChanged}
            onKeyDown={this.onBranchFilterKeyDown}
            onSearchCleared={this.handleEscape}
          />
        </div>

        {showBranchList ? this.renderFilterList() : this.renderCommits()}
        <AriaLiveContainer
          message={this.state.historyStatusMessage}
          trackedUserInput={this.state.historyStatusChangeSignal}
        />
      </div>
    )
  }

  private onBranchesListRef = (branchList: BranchList | null) => {
    this.branchList = branchList
  }

  private renderCommits() {
    const formState = this.props.compareState.formState
    return (
      <div className="compare-commit-list">
        {formState.kind === HistoryTabMode.History ? (
          <>
            {this.renderHistoryOrderSelector(formState)}
            {this.renderCommitList()}
          </>
        ) : (
          this.renderTabBar(formState)
        )}
      </div>
    )
  }

  private renderHistoryOrderSelector(formState: IDisplayHistory) {
    return (
      <div className="commit-history-order-selector">
        <label htmlFor="commit-history-order-select">Order</label>
        <Button
          className="clear-commit-history-button button-with-icon"
          size="small"
          disabled={
            this.props.readCommitSHAs.size === 0 &&
            this.props.bookmarkedCommitSHAs.size === 0
          }
          ariaHaspopup="menu"
          ariaLabel="Clear commit tracking or bookmarks"
          tooltip="Clear commit tracking or bookmarks"
          onClick={this.onShowClearMenu}
          onContextMenu={this.onClearMenuContextMenu}
          onKeyDown={this.onClearMenuKeyDown}
        >
          Clear
          <Octicon symbol={octicons.chevronDown} />
        </Button>
        <select
          id="commit-history-order-select"
          value={formState.order}
          disabled={this.state.isChangingHistoryOrder}
          onChange={this.onHistoryOrderChanged}
        >
          <option value={CommitHistoryOrder.NewestFirst}>Newest First</option>
          <option value={CommitHistoryOrder.OldestFirst}>Oldest First</option>
        </select>
      </div>
    )
  }

  private onShowClearMenu = () => {
    const items: ReadonlyArray<IMenuItem> = [
      {
        label: 'Clear bookmarks',
        enabled: this.props.bookmarkedCommitSHAs.size > 0,
        action: this.onClearCommitBookmarks,
      },
      {
        label: 'Clear tracking',
        enabled: this.props.readCommitSHAs.size > 0,
        action: this.onClearCommitReadStatus,
      },
    ]

    showContextualMenu(items)
  }

  private onClearMenuContextMenu = (
    event: React.MouseEvent<HTMLButtonElement>
  ) => {
    event.preventDefault()
    this.onShowClearMenu()
  }

  private onClearMenuKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>
  ) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      this.onShowClearMenu()
    }
  }

  private onClearCommitReadStatus = () => {
    if (this.props.readCommitSHAs.size === 0) {
      return
    }

    this.setState(state => ({
      historyStatusMessage: 'Cleared commit read tracking.',
      historyStatusChangeSignal: !state.historyStatusChangeSignal,
    }))
    this.props.dispatcher.clearCommitReadStatus(this.props.repository)
  }

  private onClearCommitBookmarks = () => {
    if (this.props.bookmarkedCommitSHAs.size === 0) {
      return
    }

    this.setState(state => ({
      historyStatusMessage: 'Cleared all commit bookmarks.',
      historyStatusChangeSignal: !state.historyStatusChangeSignal,
    }))
    this.props.dispatcher.clearCommitBookmarks(this.props.repository)
  }

  private onHistoryOrderChanged = async (
    event: React.FormEvent<HTMLSelectElement>
  ) => {
    const order = event.currentTarget.value as CommitHistoryOrder
    const formState = this.props.compareState.formState

    if (
      formState.kind !== HistoryTabMode.History ||
      formState.order === order ||
      this.state.isChangingHistoryOrder
    ) {
      return
    }

    this.setState({ isChangingHistoryOrder: true })
    try {
      const didChange = await this.props.dispatcher.executeCompare(
        this.props.repository,
        { kind: HistoryTabMode.History, order }
      )

      if (didChange) {
        this.props.onCompareListScrolled(0)
      }
    } finally {
      this.setState({ isChangingHistoryOrder: false })
    }
  }

  private filterListResultsChanged = (resultCount: number) => {
    this.resultCount = resultCount
  }

  private viewHistoryForBranch = () => {
    this.props.dispatcher.executeCompare(this.props.repository, {
      kind: HistoryTabMode.History,
      order: getRepositoryHistoryOrder(this.props.repository),
    })

    this.props.dispatcher.updateCompareForm(this.props.repository, {
      showBranchList: false,
    })
  }

  private renderCommitList() {
    const { formState } = this.props.compareState
    const isOldestFirst =
      formState.kind === HistoryTabMode.History &&
      formState.order === CommitHistoryOrder.OldestFirst
    const displayCommitSHAs = this.getDisplayCommitSHAs()
    const canReorder =
      formState.kind === HistoryTabMode.History && !isOldestFirst

    let emptyListMessage: string | JSX.Element
    if (formState.kind === HistoryTabMode.History) {
      emptyListMessage = 'No history'
    } else {
      const currentlyComparedBranchName = formState.comparisonBranch.name

      emptyListMessage =
        formState.comparisonMode === ComparisonMode.Ahead ? (
          <p>
            The compared branch (<Ref>{currentlyComparedBranchName}</Ref>) is up
            to date with your branch
          </p>
        ) : (
          <p>
            Your branch is up to date with the compared branch (
            <Ref>{currentlyComparedBranchName}</Ref>)
          </p>
        )
    }

    return (
      <CommitList
        ref={this.commitListRef}
        gitHubRepository={this.props.repository.gitHubRepository}
        isLocalRepository={this.props.isLocalRepository}
        commitLookup={this.props.commitLookup}
        commitSHAs={displayCommitSHAs}
        selectedSHAs={this.props.selectedCommitShas}
        shasToHighlight={this.props.shasToHighlight}
        localCommitSHAs={this.props.localCommitSHAs}
        canResetToCommits={formState.kind === HistoryTabMode.History}
        canUndoCommits={formState.kind === HistoryTabMode.History}
        canAmendCommits={formState.kind === HistoryTabMode.History}
        emoji={this.props.emoji}
        reorderingEnabled={canReorder}
        onViewCommitOnGitHub={this.props.onViewCommitOnGitHub}
        onUndoCommit={this.onUndoCommit}
        onResetToCommit={this.onResetToCommit}
        onRevertCommit={
          ableToRevertCommit(this.props.compareState.formState)
            ? this.props.onRevertCommit
            : undefined
        }
        onAmendCommit={this.props.onAmendCommit}
        onCommitsSelected={this.onCommitsSelected}
        onScroll={this.onScroll}
        onCreateBranch={this.onCreateBranch}
        onCheckoutCommit={this.onCheckoutCommit}
        onCreateTag={this.onCreateTag}
        onDeleteTag={this.onDeleteTag}
        onCherryPick={this.onCherryPick}
        onDropCommitInsertion={this.onDropCommitInsertion}
        onKeyboardReorder={this.onKeyboardReorder}
        onCancelKeyboardReorder={this.onCancelKeyboardReorder}
        onSquash={this.onSquash}
        emptyListMessage={emptyListMessage}
        onCompareListScrolled={this.props.onCompareListScrolled}
        compareListScrollTop={this.props.compareListScrollTop}
        tagsToPush={this.props.tagsToPush ?? []}
        onRenderCommitDragElement={this.onRenderCommitDragElement}
        onRemoveCommitDragElement={this.onRemoveCommitDragElement}
        disableReordering={!canReorder}
        disableSquashing={!canReorder}
        isMultiCommitOperationInProgress={
          this.props.isMultiCommitOperationInProgress
        }
        keyboardReorderData={this.state.keyboardReorderData}
        accounts={this.props.accounts}
        preferAbsoluteDates={this.props.preferAbsoluteDates}
        showHistoryNavigation={formState.kind === HistoryTabMode.History}
        isLoadingAllCommits={this.state.isLoadingAllCommits}
        onLoadAllAndGoToBottom={this.onLoadAllAndGoToBottom}
        onCancelLoadAllCommits={this.onCancelLoadAllCommits}
        onGoToTop={this.onGoToTop}
        onGoToSelectedCommit={this.onGoToSelectedCommit}
        readCommitSHAs={
          formState.kind === HistoryTabMode.History
            ? this.props.readCommitSHAs
            : undefined
        }
        bookmarkedCommitSHAs={
          formState.kind === HistoryTabMode.History
            ? this.props.bookmarkedCommitSHAs
            : undefined
        }
        onToggleCommitReadStatus={
          formState.kind === HistoryTabMode.History
            ? this.onToggleCommitReadStatus
            : undefined
        }
        onToggleCommitBookmark={
          formState.kind === HistoryTabMode.History
            ? this.onToggleCommitBookmark
            : undefined
        }
      />
    )
  }

  private onToggleCommitReadStatus = (commit: Commit) => {
    const action = this.props.readCommitSHAs.has(commit.sha) ? 'unread' : 'read'
    this.setState(state => ({
      historyStatusMessage: `Marked ${
        commit.summary || 'empty commit'
      } as ${action}.`,
      historyStatusChangeSignal: !state.historyStatusChangeSignal,
    }))
    this.props.dispatcher.toggleCommitReadStatus(this.props.repository, [
      commit.sha,
    ])
  }

  private onToggleCommitBookmark = (commit: Commit) => {
    const isBookmarked = this.props.bookmarkedCommitSHAs.has(commit.sha)
    this.setState(state => ({
      historyStatusMessage: `${
        isBookmarked ? 'Removed bookmark from' : 'Bookmarked'
      } ${commit.summary || 'empty commit'}.`,
      historyStatusChangeSignal: !state.historyStatusChangeSignal,
    }))
    this.props.dispatcher.toggleCommitBookmark(this.props.repository, [
      commit.sha,
    ])
  }

  public toggleSelectedCommitReadStatus() {
    if (
      !this.isHistoryView() ||
      this.props.compareState.showBranchList ||
      this.props.selectedCommitShas.length === 0
    ) {
      return
    }

    const selectedCommitShas = this.props.selectedCommitShas
    const historyStatusMessage =
      selectedCommitShas.length === 1
        ? this.props.readCommitSHAs.has(selectedCommitShas[0])
          ? 'Marked selected commit as unread.'
          : 'Marked selected commit as read.'
        : `Toggled read status for ${selectedCommitShas.length} commits.`

    this.setState(state => ({
      historyStatusMessage,
      historyStatusChangeSignal: !state.historyStatusChangeSignal,
    }))
    this.props.dispatcher.toggleCommitReadStatus(
      this.props.repository,
      selectedCommitShas
    )
  }

  public toggleSelectedCommitBookmarks() {
    if (
      !this.isHistoryView() ||
      this.props.compareState.showBranchList ||
      this.props.selectedCommitShas.length === 0
    ) {
      return
    }

    const selectedCommitShas = this.props.selectedCommitShas
    const historyStatusMessage =
      selectedCommitShas.length === 1
        ? this.props.bookmarkedCommitSHAs.has(selectedCommitShas[0])
          ? 'Removed bookmark from selected commit.'
          : 'Bookmarked selected commit.'
        : `Toggled bookmarks for ${selectedCommitShas.length} commits.`

    this.setState(state => ({
      historyStatusMessage,
      historyStatusChangeSignal: !state.historyStatusChangeSignal,
    }))
    this.props.dispatcher.toggleCommitBookmark(
      this.props.repository,
      selectedCommitShas
    )
  }

  public navigateBookmarkedCommit(
    direction: BookmarkedCommitNavigationDirection
  ) {
    if (!this.isHistoryView() || this.props.compareState.showBranchList) {
      return
    }

    const targetSHA = getBookmarkedCommitNavigationTarget(
      this.getDisplayCommitSHAs(),
      this.props.selectedCommitShas,
      this.props.bookmarkedCommitSHAs,
      direction
    )
    const targetCommit =
      targetSHA === undefined
        ? undefined
        : this.props.commitLookup.get(targetSHA)

    if (targetCommit === undefined) {
      this.setState(state => ({
        historyStatusMessage: 'No other bookmarked commits in loaded history.',
        historyStatusChangeSignal: !state.historyStatusChangeSignal,
      }))
      return
    }

    this.setState(state => ({
      historyStatusMessage: `Selected bookmarked commit: ${
        targetCommit.summary || 'empty commit'
      }.`,
      historyStatusChangeSignal: !state.historyStatusChangeSignal,
    }))
    this.onCommitsSelected([targetCommit], true)
    this.commitListRef.current?.scrollToSHANearTop(targetCommit.sha)
  }

  private getDisplayCommitSHAs(): ReadonlyArray<string> {
    const { formState, commitSHAs } = this.props.compareState
    return formState.kind === HistoryTabMode.History &&
      formState.order === CommitHistoryOrder.OldestFirst
      ? [...commitSHAs].reverse()
      : commitSHAs
  }

  private isHistoryView(props = this.props) {
    return props.compareState.formState.kind === HistoryTabMode.History
  }

  private clearLoadingMoreCommitsPromise = (
    promise: Promise<boolean>,
    useCooldown: boolean
  ) => {
    const clear = () => {
      if (this.loadingMoreCommitsPromise === promise) {
        this.loadingMoreCommitsPromise = null
      }
    }

    if (useCooldown) {
      window.setTimeout(clear, 500)
    } else {
      clear()
    }
  }

  private requestNextCommitBatch(useCooldown: boolean) {
    if (this.loadingMoreCommitsPromise !== null) {
      return this.loadingMoreCommitsPromise
    }

    const promise = this.props.dispatcher.loadNextCommitBatch(
      this.props.repository
    )
    this.loadingMoreCommitsPromise = promise
    promise.then(
      () => this.clearLoadingMoreCommitsPromise(promise, useCooldown),
      () => this.clearLoadingMoreCommitsPromise(promise, useCooldown)
    )
    return promise
  }

  private waitForCommitCountToIncrease(
    previousCount: number,
    generation: number
  ) {
    if (
      this.props.compareState.commitSHAs.length > previousCount ||
      generation !== this.loadAllGeneration
    ) {
      return Promise.resolve()
    }

    return new Promise<void>(resolve => {
      this.commitCountWaiter?.resolve()
      this.commitCountWaiter = { previousCount, generation, resolve }
    })
  }

  private cancelLoadAllCommits(updateState = true) {
    this.clearLoadAllTimeout()

    if (!this.isLoadingAllCommits) {
      return
    }

    this.isLoadingAllCommits = false
    this.loadAllGeneration++
    this.commitCountWaiter?.resolve()
    this.commitCountWaiter = null

    if (updateState && !this.isUnmounted) {
      this.setState({ isLoadingAllCommits: false })
    }
  }

  private clearLoadAllTimeout() {
    if (this.loadAllTimeoutID !== null) {
      window.clearTimeout(this.loadAllTimeoutID)
      this.loadAllTimeoutID = null
    }
  }

  private onCancelLoadAllCommits = () => {
    this.cancelLoadAllCommits()
  }

  private onLoadAllAndGoToBottom = async () => {
    if (this.isLoadingAllCommits || !this.isHistoryView()) {
      return
    }

    this.isLoadingAllCommits = true
    const generation = ++this.loadAllGeneration
    this.setState({ isLoadingAllCommits: true })
    this.commitListRef.current?.scrollToBottom()
    this.loadAllTimeoutID = window.setTimeout(() => {
      if (generation === this.loadAllGeneration) {
        this.cancelLoadAllCommits()
      }
    }, LoadAllCommitsTimeout)

    try {
      while (generation === this.loadAllGeneration && this.isHistoryView()) {
        const previousCount = this.props.compareState.commitSHAs.length
        const promise = this.requestNextCommitBatch(false)
        const didLoadCommits = await promise

        // A pre-existing lazy-load request can still have a cooldown scheduled.
        // Once load-all owns the sequence it should continue immediately.
        this.clearLoadingMoreCommitsPromise(promise, false)

        if (
          !didLoadCommits ||
          generation !== this.loadAllGeneration ||
          !this.isHistoryView()
        ) {
          break
        }

        await this.waitForCommitCountToIncrease(previousCount, generation)

        if (generation === this.loadAllGeneration) {
          this.commitListRef.current?.scrollToBottom()
        }
      }
    } finally {
      if (generation === this.loadAllGeneration) {
        this.clearLoadAllTimeout()
        this.isLoadingAllCommits = false
        if (!this.isUnmounted) {
          this.setState({ isLoadingAllCommits: false })
        }
      }
    }
  }

  private onGoToTop = () => {
    this.cancelLoadAllCommits()
    this.commitListRef.current?.scrollToTop()
  }

  private onGoToSelectedCommit = async () => {
    const selectedSHA = this.props.selectedCommitShas.at(0)
    if (selectedSHA === undefined) {
      return
    }

    const inFlightBatch = this.loadingMoreCommitsPromise
    this.cancelLoadAllCommits()

    if (inFlightBatch !== null) {
      try {
        await inFlightBatch
      } catch {
        // The selected commit is already loaded, so navigation can still work.
      }
    }

    if (!this.isUnmounted && this.isHistoryView()) {
      this.commitListRef.current?.scrollToSHA(selectedSHA)
    }
  }

  private onCancelKeyboardReorder = () => {
    this.setState({ keyboardReorderData: undefined })
  }

  private onDropCommitInsertion = async (
    baseCommit: Commit | null,
    commitsToInsert: ReadonlyArray<Commit>,
    lastRetainedCommitRef: string | null
  ) => {
    this.setState({ keyboardReorderData: undefined })

    if (
      await doMergeCommitsExistAfterCommit(
        this.props.repository,
        lastRetainedCommitRef
      )
    ) {
      defaultErrorHandler(
        new Error(
          `Unable to reorder. Reordering replays all commits up to the last one required for the reorder. A merge commit cannot exist among those commits.`
        ),
        this.props.dispatcher
      )
      return
    }

    return this.props.dispatcher.reorderCommits(
      this.props.repository,
      commitsToInsert,
      baseCommit,
      lastRetainedCommitRef
    )
  }

  private onRenderCommitDragElement = (
    commit: Commit,
    selectedCommits: ReadonlyArray<Commit>
  ) => {
    this.props.dispatcher.setDragElement({
      type: DragType.Commit,
      commit,
      selectedCommits,
      gitHubRepository: this.props.repository.gitHubRepository,
    })
  }

  private onRemoveCommitDragElement = () => {
    this.props.dispatcher.clearDragElement()
  }

  private renderActiveTab(view: ICompareBranch) {
    return (
      <div className="compare-commit-list">
        {this.renderCommitList()}
        {view.comparisonMode === ComparisonMode.Behind
          ? this.renderMergeCallToAction(view)
          : null}
      </div>
    )
  }

  private renderFilterList() {
    const { defaultBranch, branches, recentBranches, filterText } =
      this.props.compareState

    return (
      <BranchList
        repository={this.props.repository}
        ref={this.onBranchesListRef}
        defaultBranch={defaultBranch}
        currentBranch={this.props.currentBranch}
        allBranches={branches}
        recentBranches={recentBranches}
        filterText={filterText}
        textbox={this.textbox!}
        selectedBranch={this.state.focusedBranch}
        canCreateNewBranch={false}
        onSelectionChanged={this.onSelectionChanged}
        onItemClick={this.onBranchItemClicked}
        onFilterTextChanged={this.onBranchFilterTextChanged}
        renderBranch={this.renderCompareBranchListItem}
        getBranchAriaLabel={this.getBranchAriaLabel}
        onFilterListResultsChanged={this.filterListResultsChanged}
      />
    )
  }

  private renderMergeCallToAction(formState: ICompareBranch) {
    if (this.props.currentBranch == null) {
      return null
    }

    return (
      <MergeCallToActionWithConflicts
        repository={this.props.repository}
        dispatcher={this.props.dispatcher}
        mergeStatus={this.props.compareState.mergeStatus}
        currentBranch={this.props.currentBranch}
        comparisonBranch={formState.comparisonBranch}
        commitsBehind={formState.aheadBehind.behind}
      />
    )
  }

  private onTabClicked = (index: number) => {
    const formState = this.props.compareState.formState

    if (formState.kind === HistoryTabMode.History) {
      return
    }

    const comparisonMode =
      index === 0 ? ComparisonMode.Behind : ComparisonMode.Ahead
    const branch = formState.comparisonBranch

    this.props.dispatcher.executeCompare(this.props.repository, {
      kind: HistoryTabMode.Compare,
      branch,
      comparisonMode,
    })
  }

  private renderTabBar(formState: ICompareBranch) {
    const selectedTab =
      formState.comparisonMode === ComparisonMode.Behind ? 0 : 1

    return (
      <div className="compare-content">
        <TabBar selectedIndex={selectedTab} onTabClicked={this.onTabClicked}>
          <span>{`Behind (${formatNumber(
            formState.aheadBehind.behind
          )})`}</span>
          <span>{`Ahead (${formatNumber(formState.aheadBehind.ahead)})`}</span>
        </TabBar>
        {this.renderActiveTab(formState)}
      </div>
    )
  }

  private renderCompareBranchListItem = (
    item: IBranchListItem,
    matches: IMatches
  ) => {
    return (
      <CompareBranchListItem
        branch={item.branch}
        currentBranch={this.props.currentBranch}
        matches={matches}
        repository={this.props.repository}
        aheadBehindStore={this.props.aheadBehindStore}
      />
    )
  }

  private getBranchAriaLabel = (item: IBranchListItem): string => {
    return item.branch.name
  }

  private onBranchFilterKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement>
  ) => {
    const key = event.key

    if (key === 'Enter') {
      if (this.resultCount === 0) {
        event.preventDefault()
        return
      }
      const branch = this.state.focusedBranch

      if (branch === null) {
        this.viewHistoryForBranch()
      } else {
        this.props.dispatcher.executeCompare(this.props.repository, {
          kind: HistoryTabMode.Compare,
          comparisonMode: ComparisonMode.Behind,
          branch,
        })

        this.props.dispatcher.updateCompareForm(this.props.repository, {
          filterText: branch.name,
        })
      }

      if (this.textbox) {
        this.textbox.blur()
      }
    } else if (key === 'Escape') {
      this.handleEscape()
    } else if (key === 'ArrowDown') {
      if (this.branchList !== null) {
        this.branchList.selectNextItem(true, 'down')
      }
    } else if (key === 'ArrowUp') {
      if (this.branchList !== null) {
        this.branchList.selectNextItem(true, 'up')
      }
    }
  }

  private handleEscape = () => {
    this.clearFilterState()
    if (this.textbox) {
      this.textbox.blur()
    }
  }

  private onCommitsSelected = (
    commits: ReadonlyArray<Commit>,
    isContiguous: boolean
  ) => {
    this.props.dispatcher.changeCommitSelection(
      this.props.repository,
      commits.map(c => c.sha),
      isContiguous
    )

    this.loadChangedFilesScheduler.queue(() => {
      this.props.dispatcher.loadChangedFilesForCurrentSelection(
        this.props.repository
      )
    })
  }

  private onScroll = (start: number, end: number) => {
    const compareState = this.props.compareState
    const formState = compareState.formState

    if (formState.kind === HistoryTabMode.Compare) {
      // as the app is currently comparing the current branch to some other
      // branch, everything needed should be loaded
      return
    }

    if (this.isLoadingAllCommits) {
      return
    }

    const commits = compareState.commitSHAs
    if (commits.length - end <= CloseToBottomThreshold) {
      this.requestNextCommitBatch(true)
    }
  }

  private onBranchFilterTextChanged = (filterText: string) => {
    if (filterText.length === 0) {
      this.setState({ focusedBranch: null })
    }

    this.props.dispatcher.updateCompareForm(this.props.repository, {
      filterText,
    })
  }

  private clearFilterState = () => {
    this.setState({
      focusedBranch: null,
    })

    this.props.dispatcher.updateCompareForm(this.props.repository, {
      filterText: '',
    })

    this.viewHistoryForBranch()
  }

  private onBranchItemClicked = (branch: Branch) => {
    this.props.dispatcher.executeCompare(this.props.repository, {
      kind: HistoryTabMode.Compare,
      comparisonMode: ComparisonMode.Behind,
      branch,
    })

    this.setState({
      focusedBranch: null,
    })

    this.props.dispatcher.updateCompareForm(this.props.repository, {
      filterText: branch.name,
      showBranchList: false,
    })
  }

  private onSelectionChanged = (
    branch: Branch | null,
    source: SelectionSource
  ) => {
    this.setState({
      focusedBranch: branch,
    })
  }

  private onTextBoxFocused = () => {
    this.props.dispatcher.updateCompareForm(this.props.repository, {
      showBranchList: true,
    })
  }

  private onTextBoxRef = (textbox: TextBox) => {
    this.textbox = textbox
  }

  private onCreateTag = (targetCommitSha: string) => {
    this.props.dispatcher.showCreateTagDialog(
      this.props.repository,
      targetCommitSha,
      this.props.localTags
    )
  }

  private onUndoCommit = (commit: Commit) => {
    this.props.dispatcher.undoCommit(this.props.repository, commit)
  }

  private onResetToCommit = (commit: Commit) => {
    this.props.dispatcher.resetToCommit(this.props.repository, commit)
  }

  private onCreateBranch = (commit: CommitOneLine) => {
    const { repository, dispatcher } = this.props

    dispatcher.showPopup({
      type: PopupType.CreateBranch,
      repository,
      targetCommit: commit,
    })
  }

  private onCheckoutCommit = (commit: CommitOneLine) => {
    const { repository, dispatcher, askForConfirmationOnCheckoutCommit } =
      this.props
    if (!askForConfirmationOnCheckoutCommit) {
      dispatcher.checkoutCommit(repository, commit)
    } else {
      dispatcher.showPopup({
        type: PopupType.ConfirmCheckoutCommit,
        commit: commit,
        repository,
      })
    }
  }

  private onDeleteTag = (tagName: string) => {
    this.props.dispatcher.showDeleteTagDialog(this.props.repository, tagName)
  }

  private onCherryPick = (commits: ReadonlyArray<CommitOneLine>) => {
    this.props.onCherryPick(this.props.repository, commits)
  }

  private onKeyboardReorder = (toReorder: ReadonlyArray<Commit>) => {
    const { commitSHAs } = this.props.compareState

    this.setState({
      keyboardReorderData: {
        type: DragType.Commit,
        commits: toReorder,
        itemIndices: toReorder.map(c => commitSHAs.indexOf(c.sha)),
      },
    })
  }

  private onSquash = async (
    toSquash: ReadonlyArray<Commit>,
    squashOnto: Commit,
    lastRetainedCommitRef: string | null,
    isInvokedByContextMenu: boolean
  ) => {
    const toSquashSansSquashOnto = toSquash.filter(
      c => c.sha !== squashOnto.sha
    )

    const allCommitsInSquash = [...toSquashSansSquashOnto, squashOnto]
    const coAuthors = getUniqueCoauthorsAsAuthors(allCommitsInSquash)

    const squashedDescription = getSquashedCommitDescription(
      toSquashSansSquashOnto,
      squashOnto
    )

    if (
      await doMergeCommitsExistAfterCommit(
        this.props.repository,
        lastRetainedCommitRef
      )
    ) {
      defaultErrorHandler(
        new Error(
          `Unable to squash. Squashing replays all commits up to the last one required for the squash. A merge commit cannot exist among those commits.`
        ),
        this.props.dispatcher
      )
      return
    }

    this.props.dispatcher.recordSquashInvoked(isInvokedByContextMenu)

    this.props.dispatcher.showPopup({
      type: PopupType.CommitMessage,
      repository: this.props.repository,
      coAuthors,
      showCoAuthoredBy: coAuthors.length > 0,
      commitMessage: {
        summary: squashOnto.summary,
        description: squashedDescription,
        timestamp: Date.now(),
      },
      dialogTitle: `Squash ${allCommitsInSquash.length} Commits`,
      dialogButtonText: `Squash ${allCommitsInSquash.length} Commits`,
      prepopulateCommitSummary: true,
      onSubmitCommitMessage: async (context: ICommitContext) => {
        this.props.dispatcher.closePopup(PopupType.CommitMessage)

        this.props.dispatcher.squash(
          this.props.repository,
          toSquashSansSquashOnto,
          squashOnto,
          lastRetainedCommitRef,
          context
        )
        return true
      },
    })
  }
}

function getPlaceholderText(state: ICompareState) {
  const { branches, formState } = state

  if (!branches.some(b => !b.isDesktopForkRemoteBranch)) {
    return __DARWIN__ ? 'No Branches to Compare' : 'No branches to compare'
  } else if (formState.kind === HistoryTabMode.History) {
    return __DARWIN__
      ? 'Select Branch to Compare…'
      : 'Select branch to compare…'
  } else {
    return undefined
  }
}

// determine if the `onRevertCommit` function should be exposed to the CommitList/CommitListItem.
// `onRevertCommit` is only exposed if the form state of the branch compare form is either
// 1: History mode, 2: Comparison Mode with the 'Ahead' list shown.
// When not exposed, the context menu item 'Revert this commit' is disabled.
function ableToRevertCommit(
  formState: IDisplayHistory | ICompareBranch
): boolean {
  return (
    formState.kind === HistoryTabMode.History ||
    formState.comparisonMode === ComparisonMode.Ahead
  )
}
