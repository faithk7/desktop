import * as Path from 'path'
import * as React from 'react'
import debounce from 'lodash/debounce'
import { readdir } from 'fs/promises'
import { Account } from '../../models/account'
import { Repository } from '../../models/repository'
import { CloningRepository } from '../../models/cloning-repository'
import { ICloneProgress } from '../../models/progress'
import {
  CommitHistoryOrder,
  HistoryTabMode,
  PossibleSelections,
  RepositorySectionTab,
  SelectionType,
} from '../../lib/app-state'
import {
  API,
  IAPIRepositorySearchItem,
  IAPISearchResponse,
  IAPITopicSearchItem,
} from '../../lib/api'
import {
  buildRepositorySearchQuery,
  buildTopicSearchQuery,
  ExplorerPage,
  ExplorerRepositorySort,
  ExplorerTopicFilter,
  getRepositorySearchSort,
  rankTopics,
  topicSizeTier,
} from '../../lib/explorer'
import {
  ExplorerTopicCacheRequest,
  getCachedExplorerTopics,
  setCachedExplorerTopics,
} from '../../lib/explorer-topic-cache'
import { sanitizeCloneName } from '../../lib/remote-parsing'
import { matchExistingRepository } from '../../lib/repository-matching'
import { getDefaultDir } from '../lib/default-dir'
import { Dispatcher } from '../dispatcher'
import { TextBox } from '../lib/text-box'
import { Select } from '../lib/select'
import { Button } from '../lib/button'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { AriaLiveContainer } from '../accessibility/aria-live-container'
import { showOpenDialog } from '../main-process-proxy'

interface IExplorerProps {
  readonly accounts: ReadonlyArray<Account>
  readonly repositories: ReadonlyArray<Repository | CloningRepository>
  readonly cloningRepositoryStateLookup: ReadonlyMap<number, ICloneProgress>
  readonly selectedState: PossibleSelections | null
  readonly dispatcher: Dispatcher
  readonly initialSessionState?: IExplorerSessionState
  readonly onSessionStateChanged: (state: IExplorerSessionState) => void
  readonly onClose: () => void
}

interface IActiveClone {
  readonly repository: IAPIRepositorySearchItem
  readonly path: string
  readonly error: string | null
}

export interface IExplorerSessionState {
  readonly page: ExplorerPage
  readonly repositoryQuery: string
  readonly topicQuery: string
  readonly repositorySort: ExplorerRepositorySort
  readonly topicFilter: ExplorerTopicFilter
  readonly repositoryPage: number
  readonly topicPage: number
  readonly repositoryResults: IAPISearchResponse<IAPIRepositorySearchItem> | null
  readonly topicResults: IAPISearchResponse<IAPITopicSearchItem> | null
  readonly popularTopics: ReadonlyArray<IAPITopicSearchItem> | null
  readonly selectedTopic: string | null
  readonly popularTopicsScrollTop: number
}

interface IExplorerState extends IExplorerSessionState {
  /** Repository text being edited but not yet submitted. */
  readonly repositoryDraft: string
  /** Topic text being edited but not yet submitted. */
  readonly topicDraft: string
  readonly loadingRepositories: boolean
  readonly loadingTopics: boolean
  readonly loadingPopularTopics: boolean
  readonly error: string | null
  readonly activeClones: ReadonlyMap<string, IActiveClone>
}

const RepositoryPageSize = 30
const TopicPageSize = 100
const RepositoryPageCacheSize = 8

function sessionStateChanged(
  previous: IExplorerState,
  current: IExplorerState
): boolean {
  return (
    previous.page !== current.page ||
    previous.repositoryQuery !== current.repositoryQuery ||
    previous.topicQuery !== current.topicQuery ||
    previous.repositorySort !== current.repositorySort ||
    previous.topicFilter !== current.topicFilter ||
    previous.repositoryPage !== current.repositoryPage ||
    previous.topicPage !== current.topicPage ||
    previous.repositoryResults !== current.repositoryResults ||
    previous.topicResults !== current.topicResults ||
    previous.popularTopics !== current.popularTopics ||
    previous.selectedTopic !== current.selectedTopic ||
    previous.popularTopicsScrollTop !== current.popularTopicsScrollTop
  )
}

export class Explorer extends React.Component<IExplorerProps, IExplorerState> {
  private repositoryRequest = 0
  private topicRequest = 0
  private popularTopicsRequest = 0
  private popularTopicsPromise: Promise<
    ReadonlyArray<IAPITopicSearchItem>
  > | null = null
  private readonly cloneCancellationRequests = new Set<string>()
  private readonly cloneStartRequests = new Set<string>()
  private readonly cloneDestinationReservations = new Map<string, string>()
  private readonly parallelCloneBatch = new Set<string>()
  private readonly repositoryPageCache = new Map<
    string,
    Promise<IAPISearchResponse<IAPIRepositorySearchItem>>
  >()
  private readonly topicSearchPromises = new Map<
    string,
    Promise<IAPISearchResponse<IAPITopicSearchItem>>
  >()
  private readonly searchResultsRef = React.createRef<HTMLElement>()
  private readonly popularTopicsScrollRef = React.createRef<HTMLDivElement>()

  private savePopularTopicsScrollDebounced = debounce(
    (popularTopicsScrollTop: number) => {
      if (popularTopicsScrollTop !== this.state.popularTopicsScrollTop) {
        this.setState({ popularTopicsScrollTop })
      }
    },
    100,
    { maxWait: 500 }
  )

  public constructor(props: IExplorerProps) {
    super(props)
    const initialSessionState = props.initialSessionState
    this.state = {
      page: ExplorerPage.Search,
      repositoryQuery: '',
      topicQuery: '',
      repositorySort: ExplorerRepositorySort.BestMatch,
      topicFilter: ExplorerTopicFilter.All,
      repositoryPage: 1,
      topicPage: 1,
      repositoryResults: null,
      topicResults: null,
      popularTopics: null,
      selectedTopic: null,
      popularTopicsScrollTop: 0,
      ...initialSessionState,
      repositoryDraft: initialSessionState?.repositoryQuery ?? '',
      topicDraft: initialSessionState?.topicQuery ?? '',
      loadingRepositories: false,
      loadingTopics: false,
      loadingPopularTopics: false,
      error: null,
      activeClones: new Map(),
    }
  }

  public componentDidMount() {
    this.restorePopularTopicsScroll()

    if (this.api !== null && this.state.popularTopics === null) {
      this.loadPopularTopics()
    }

    const api = this.api
    const results = this.state.repositoryResults
    const query = this.repositorySearchQuery
    if (api !== null && results !== null && query.length > 0) {
      const sort = getRepositorySearchSort(this.state.repositorySort)
      this.cacheRepositoryPage(query, this.state.repositoryPage, sort, results)
      this.prefetchNextRepositoryPage(
        api,
        query,
        this.state.repositoryPage,
        sort,
        results.total_count
      )
    }
  }

  public componentDidUpdate(
    prevProps: IExplorerProps,
    prevState: IExplorerState
  ) {
    if (sessionStateChanged(prevState, this.state)) {
      const {
        page,
        repositoryQuery,
        topicQuery,
        repositorySort,
        topicFilter,
        repositoryPage,
        topicPage,
        repositoryResults,
        topicResults,
        popularTopics,
        selectedTopic,
        popularTopicsScrollTop,
      } = this.state

      this.props.onSessionStateChanged({
        page,
        repositoryQuery,
        topicQuery,
        repositorySort,
        topicFilter,
        repositoryPage,
        topicPage,
        repositoryResults,
        topicResults,
        popularTopics,
        selectedTopic,
        popularTopicsScrollTop,
      })
    }

    if (
      prevState.page !== ExplorerPage.Search &&
      this.state.page === ExplorerPage.Search
    ) {
      this.restorePopularTopicsScroll()
    }

    const previousEndpoint = prevProps.accounts[0]?.endpoint ?? null
    const endpoint = this.account?.endpoint ?? null
    if (previousEndpoint !== endpoint) {
      this.popularTopicsRequest++
      this.topicRequest++
      this.popularTopicsPromise = null
      this.topicSearchPromises.clear()

      if (endpoint !== null) {
        this.setState(
          {
            popularTopics: null,
            topicResults: null,
            popularTopicsScrollTop: 0,
            loadingPopularTopics: false,
            loadingTopics: false,
          },
          this.loadPopularTopics
        )
      }
    }
  }

  public componentWillUnmount() {
    this.savePopularTopicsScrollDebounced.cancel()
    this.repositoryRequest++
    this.topicRequest++
    this.popularTopicsRequest++
  }

  private get account(): Account | null {
    return this.props.accounts[0] ?? null
  }

  private get api(): API | null {
    return this.account === null ? null : API.fromAccount(this.account)
  }

  private get repositorySearchQuery(): string {
    return buildRepositorySearchQuery(
      this.state.repositoryQuery,
      this.state.selectedTopic
    )
  }

  private repositoryPageCacheKey(
    query: string,
    page: number,
    sort: ReturnType<typeof getRepositorySearchSort>
  ): string {
    return JSON.stringify([
      this.account?.endpoint ?? null,
      this.account?.id ?? null,
      query,
      page,
      sort ?? null,
    ])
  }

  private cacheRepositoryPage(
    query: string,
    page: number,
    sort: ReturnType<typeof getRepositorySearchSort>,
    results: IAPISearchResponse<IAPIRepositorySearchItem>
  ) {
    const key = this.repositoryPageCacheKey(query, page, sort)
    this.repositoryPageCache.delete(key)
    this.repositoryPageCache.set(key, Promise.resolve(results))
    this.trimRepositoryPageCache()
  }

  private getRepositoryPage(
    api: API,
    query: string,
    page: number,
    sort: ReturnType<typeof getRepositorySearchSort>
  ): Promise<IAPISearchResponse<IAPIRepositorySearchItem>> {
    const key = this.repositoryPageCacheKey(query, page, sort)
    const cached = this.repositoryPageCache.get(key)
    if (cached !== undefined) {
      // Refresh insertion order so the bounded map behaves as an LRU cache.
      this.repositoryPageCache.delete(key)
      this.repositoryPageCache.set(key, cached)
      return cached
    }

    const request = api
      .searchRepositories(query, page, RepositoryPageSize, sort)
      .catch(error => {
        if (this.repositoryPageCache.get(key) === request) {
          this.repositoryPageCache.delete(key)
        }
        throw error
      })
    this.repositoryPageCache.set(key, request)
    this.trimRepositoryPageCache()
    return request
  }

  private trimRepositoryPageCache() {
    while (this.repositoryPageCache.size > RepositoryPageCacheSize) {
      const oldest = this.repositoryPageCache.keys().next().value
      if (oldest === undefined) {
        return
      }
      this.repositoryPageCache.delete(oldest)
    }
  }

  private prefetchNextRepositoryPage(
    api: API,
    query: string,
    page: number,
    sort: ReturnType<typeof getRepositorySearchSort>,
    total: number
  ) {
    const lastPage = Math.min(
      Math.ceil(total / RepositoryPageSize),
      Math.ceil(1000 / RepositoryPageSize)
    )
    if (page < lastPage) {
      // Prefetch failures are intentionally silent. The foreground request will
      // retry and surface the error if the user navigates to that page.
      void this.getRepositoryPage(api, query, page + 1, sort).catch(() => {})
    }
  }

  private scrollToResults = () => {
    const searchResults = this.searchResultsRef.current
    if (searchResults !== null) {
      searchResults.scrollTop = 0
    }
  }

  private restorePopularTopicsScroll = () => {
    const popularTopicsScroll = this.popularTopicsScrollRef.current
    if (popularTopicsScroll !== null) {
      popularTopicsScroll.scrollTop = this.state.popularTopicsScrollTop
    }
  }

  private onPopularTopicsScroll = (event: React.UIEvent<HTMLDivElement>) => {
    this.savePopularTopicsScrollDebounced(event.currentTarget.scrollTop)
  }

  private onPageChanged = (page: ExplorerPage) => {
    this.setState({ page, error: null }, () => {
      if (page === ExplorerPage.Tags && this.state.topicResults === null) {
        this.searchTopics(1)
      }
    })
  }

  private showSearchPage = () => this.onPageChanged(ExplorerPage.Search)
  private showTagsPage = () => this.onPageChanged(ExplorerPage.Tags)

  private searchRepositoriesFirstPage = (repositoryQuery: string) => {
    this.setState(
      { repositoryDraft: repositoryQuery, repositoryQuery, error: null },
      () => this.searchRepositories(1)
    )
  }

  private searchTopicsFirstPage = (topicQuery: string) => {
    this.setState({ topicDraft: topicQuery, topicQuery, error: null }, () =>
      this.searchTopics(1)
    )
  }

  private clearRepositorySearch = () => {
    this.setState(
      { repositoryDraft: '', repositoryQuery: '', error: null },
      () => this.searchRepositories(1)
    )
  }

  private clearTopicSearch = () => {
    this.setState({ topicDraft: '', topicQuery: '', error: null }, () =>
      this.searchTopics(1)
    )
  }

  private onRepositoryQueryChanged = (repositoryDraft: string) => {
    this.setState({ repositoryDraft, error: null })
  }

  private onTopicQueryChanged = (topicDraft: string) => {
    this.setState({ topicDraft, error: null })
  }

  private onRepositorySortChanged = (
    event: React.FormEvent<HTMLSelectElement>
  ) => {
    const repositorySort = event.currentTarget.value as ExplorerRepositorySort
    this.setState({ repositorySort }, () => this.searchRepositories(1))
  }

  private onTopicFilterChanged = (
    event: React.FormEvent<HTMLSelectElement>
  ) => {
    const topicFilter = event.currentTarget.value as ExplorerTopicFilter
    this.setState({ topicFilter }, () => this.searchTopics(1))
  }

  private searchRepositories = async (page: number) => {
    const api = this.api
    const query = this.repositorySearchQuery

    if (api === null || query.length === 0) {
      this.setState({
        repositoryPage: 1,
        repositoryResults: null,
        loadingRepositories: false,
      })
      return
    }

    const request = ++this.repositoryRequest
    const sort = getRepositorySearchSort(this.state.repositorySort)
    this.setState({ loadingRepositories: true, error: null })
    try {
      const results = await this.getRepositoryPage(api, query, page, sort)
      if (request === this.repositoryRequest) {
        this.setState(
          {
            repositoryResults: results,
            repositoryPage: page,
            loadingRepositories: false,
          },
          this.scrollToResults
        )
        this.prefetchNextRepositoryPage(
          api,
          query,
          page,
          sort,
          results.total_count
        )
      }
    } catch (error) {
      if (request === this.repositoryRequest) {
        this.setState({
          loadingRepositories: false,
          error: error instanceof Error ? error.message : `${error}`,
        })
      }
    }
  }

  private searchTopics = async (page: number) => {
    const api = this.api
    const account = this.account
    if (api === null || account === null) {
      return
    }

    const request = ++this.topicRequest
    const query = buildTopicSearchQuery(
      this.state.topicQuery,
      this.state.topicFilter
    )
    if (query.length === 0) {
      const cacheRequest = { kind: 'popular' } as const
      const cached = getCachedExplorerTopics(account.endpoint, cacheRequest)
      if (cached !== null) {
        this.setState({
          topicResults: cached.results,
          popularTopics: cached.results.items,
          topicPage: 1,
          loadingTopics: false,
          error: null,
        })
        if (cached.freshness === 'fresh') {
          return
        }
      } else {
        this.setState({ loadingTopics: true, error: null })
      }

      try {
        const popularTopics = await this.refreshPopularTopics(
          api,
          account.endpoint
        )
        if (request === this.topicRequest) {
          this.setState({
            topicResults: {
              total_count: popularTopics.length,
              incomplete_results: false,
              items: popularTopics,
            },
            popularTopics,
            topicPage: 1,
            loadingTopics: false,
          })
        }
      } catch (error) {
        if (request === this.topicRequest) {
          if (cached === null) {
            this.setState({
              loadingTopics: false,
              error: error instanceof Error ? error.message : `${error}`,
            })
          } else {
            this.setState({ loadingTopics: false })
          }
        }
        if (cached !== null) {
          log.warn('Unable to refresh cached Explorer topics', error)
        }
      }
      return
    }

    const cacheRequest = { kind: 'search', query, page } as const
    const cached = getCachedExplorerTopics(account.endpoint, cacheRequest)
    if (cached !== null) {
      this.setState({
        topicResults: cached.results,
        topicPage: page,
        loadingTopics: false,
        error: null,
      })
      if (cached.freshness === 'fresh') {
        return
      }
    } else {
      this.setState({ loadingTopics: true, error: null })
    }

    try {
      const results = await this.fetchTopicSearchPage(
        api,
        account.endpoint,
        cacheRequest,
        this.state.topicQuery
      )
      if (request === this.topicRequest) {
        this.setState({
          topicResults: results,
          topicPage: page,
          loadingTopics: false,
        })
      }
    } catch (error) {
      if (request === this.topicRequest) {
        if (cached === null) {
          this.setState({
            loadingTopics: false,
            error: error instanceof Error ? error.message : `${error}`,
          })
        } else {
          this.setState({ loadingTopics: false })
        }
      }
      if (cached !== null) {
        log.warn('Unable to refresh cached Explorer topic search', error)
      }
    }
  }

  private refreshPopularTopics(
    api: API,
    endpoint: string
  ): Promise<ReadonlyArray<IAPITopicSearchItem>> {
    if (this.popularTopicsPromise === null) {
      this.popularTopicsPromise = this.fetchPopularTopics(api)
        .then(topics => {
          setCachedExplorerTopics(
            endpoint,
            { kind: 'popular' },
            {
              total_count: topics.length,
              incomplete_results: false,
              items: topics,
            }
          )
          return topics
        })
        .catch(error => {
          this.popularTopicsPromise = null
          throw error
        })
    }
    return this.popularTopicsPromise
  }

  private fetchTopicSearchPage(
    api: API,
    endpoint: string,
    cacheRequest: Extract<ExplorerTopicCacheRequest, { kind: 'search' }>,
    topicQuery: string
  ): Promise<IAPISearchResponse<IAPITopicSearchItem>> {
    const key = JSON.stringify([
      endpoint,
      cacheRequest.query.trim().toLocaleLowerCase(),
      cacheRequest.page,
    ])
    const existing = this.topicSearchPromises.get(key)
    if (existing !== undefined) {
      return existing
    }

    const promise = api
      .searchTopics(cacheRequest.query, cacheRequest.page, TopicPageSize)
      .then(async results => {
        const counts = await api.fetchTopicStargazerCounts(
          results.items.map(topic => topic.name)
        )
        const rankedResults = {
          ...results,
          items: rankTopics(
            results.items.map(topic => ({
              ...topic,
              stargazer_count: counts.get(topic.name),
            })),
            topicQuery
          ),
        }
        setCachedExplorerTopics(endpoint, cacheRequest, rankedResults)
        return rankedResults
      })

    this.topicSearchPromises.set(key, promise)
    const removePromise = () => {
      if (this.topicSearchPromises.get(key) === promise) {
        this.topicSearchPromises.delete(key)
      }
    }
    void promise.then(removePromise, removePromise)
    return promise
  }

  private fetchPopularTopics = async (
    api: API
  ): Promise<ReadonlyArray<IAPITopicSearchItem>> => {
    const repositories = await api.searchRepositories(
      'stars:>0',
      1,
      100,
      'stars'
    )
    const frequency = new Map<string, number>()
    repositories.items.forEach(repository => {
      repository.topics.forEach(topic => {
        frequency.set(topic, (frequency.get(topic) ?? 0) + 1)
      })
    })

    const names = Array.from(frequency)
      .sort(
        (left, right) => right[1] - left[1] || left[0].localeCompare(right[0])
      )
      .slice(0, TopicPageSize)
      .map(([name]) => name)
    const counts = await api.fetchTopicStargazerCounts(names)

    return names
      .map(name => ({
        name,
        display_name: null,
        short_description: null,
        featured: false,
        curated: false,
        score: frequency.get(name) ?? 0,
        stargazer_count: counts.get(name),
      }))
      .sort(
        (left, right) =>
          (right.stargazer_count ?? 0) - (left.stargazer_count ?? 0) ||
          right.score - left.score
      )
  }

  private loadPopularTopics = async () => {
    const api = this.api
    const account = this.account
    if (api === null || account === null) {
      return
    }

    const request = ++this.popularTopicsRequest
    const cached = getCachedExplorerTopics(account.endpoint, {
      kind: 'popular',
    })
    if (cached !== null) {
      this.setState({
        popularTopics: cached.results.items,
        loadingPopularTopics: false,
      })
      if (cached.freshness === 'fresh') {
        return
      }
    } else {
      this.setState({ loadingPopularTopics: true })
    }

    try {
      const popularTopics = await this.refreshPopularTopics(
        api,
        account.endpoint
      )
      if (request === this.popularTopicsRequest) {
        this.setState({ popularTopics, loadingPopularTopics: false })
      }
    } catch (error) {
      if (request === this.popularTopicsRequest) {
        this.setState({ loadingPopularTopics: false })
      }
      log.warn(
        cached === null
          ? 'Unable to load Explorer popular topics'
          : 'Unable to refresh cached Explorer popular topics',
        error
      )
    }
  }

  private openTopic = (topic: string) => {
    this.setState(
      {
        page: ExplorerPage.Search,
        selectedTopic: topic,
        repositoryDraft: '',
        repositoryQuery: '',
        repositoryResults: null,
      },
      () => this.searchRepositories(1)
    )
  }

  private clearTopic = () => {
    this.setState({ selectedTopic: null, repositoryResults: null }, () =>
      this.searchRepositories(1)
    )
  }

  private findLocalRepository(
    item: IAPIRepositorySearchItem
  ): Repository | null {
    const fullName = `${item.owner.login}/${item.name}`.toLocaleLowerCase()
    return (this.props.repositories.find(
      repository =>
        repository instanceof Repository &&
        repository.gitHubRepository !== null &&
        repository.gitHubRepository.fullName.toLocaleLowerCase() === fullName &&
        (this.account === null ||
          repository.gitHubRepository.endpoint === this.account.endpoint)
    ) ?? null) as Repository | null
  }

  private openFirstCommit = async (repository: Repository) => {
    await this.props.dispatcher.selectRepository(repository)
    await this.props.dispatcher.changeRepositorySection(
      repository,
      RepositorySectionTab.History
    )
    this.props.dispatcher.resetCurrentBranchViewState(repository)
    await this.props.dispatcher.executeCompare(repository, {
      kind: HistoryTabMode.History,
      order: CommitHistoryOrder.OldestFirst,
    })
    this.props.onClose()
  }

  private validateClonePath = async (path: string): Promise<string | null> => {
    try {
      const files = await readdir(path)
      return files.length === 0
        ? null
        : 'The destination folder already contains files.'
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      return code === 'ENOENT' ? null : 'The destination folder cannot be used.'
    }
  }

  private cloneAndRead = async (
    item: IAPIRepositorySearchItem,
    destination?: string
  ) => {
    const cloneUrl = item.clone_url
    if (
      this.cloneStartRequests.has(cloneUrl) ||
      this.state.activeClones.has(cloneUrl) ||
      this.findCloningRepository(cloneUrl) !== null
    ) {
      return
    }
    this.cloneStartRequests.add(cloneUrl)

    const local = this.findLocalRepository(item)
    if (local !== null) {
      this.cloneStartRequests.delete(cloneUrl)
      await this.openFirstCommit(local)
      return
    }

    const safeName = sanitizeCloneName(item.name)
    if (safeName === null) {
      this.cloneStartRequests.delete(cloneUrl)
      this.setState({ error: 'This repository name cannot be cloned safely.' })
      return
    }

    const path = destination ?? Path.resolve(await getDefaultDir(), safeName)
    let pathError = this.getCloneDestinationError(cloneUrl, path)
    if (pathError === null) {
      pathError = await this.validateClonePath(path)
    }
    if (pathError === null) {
      // Recheck after the asynchronous file-system validation so two clicks
      // resolving to the same destination cannot race into it.
      pathError = this.getCloneDestinationError(cloneUrl, path)
    }
    if (pathError !== null) {
      this.cloneStartRequests.delete(cloneUrl)
      this.updateActiveClone(cloneUrl, {
        repository: item,
        path,
        error: pathError,
      })
      return
    }

    const concurrentCloneUrls = new Set(
      this.props.repositories
        .filter(
          (repository): repository is CloningRepository =>
            repository instanceof CloningRepository
        )
        .map(repository => repository.url)
    )
    this.cloneDestinationReservations.forEach((_, url) =>
      concurrentCloneUrls.add(url)
    )
    this.cloneStartRequests.forEach(url => concurrentCloneUrls.add(url))
    concurrentCloneUrls.delete(cloneUrl)
    if (concurrentCloneUrls.size > 0) {
      concurrentCloneUrls.forEach(url => this.parallelCloneBatch.add(url))
      this.parallelCloneBatch.add(cloneUrl)
    }

    this.cloneDestinationReservations.set(cloneUrl, path)
    this.updateActiveClone(cloneUrl, { repository: item, path, error: null })
    this.setState({ error: null })
    this.cloneCancellationRequests.delete(cloneUrl)
    let repository: Repository | null
    try {
      repository = await this.props.dispatcher.clone(item.clone_url, path, {
        defaultBranch: item.default_branch,
      })
    } finally {
      this.cloneStartRequests.delete(cloneUrl)
      this.cloneDestinationReservations.delete(cloneUrl)
    }
    if (repository === null) {
      if (this.cloneCancellationRequests.delete(cloneUrl)) {
        this.parallelCloneBatch.delete(cloneUrl)
        this.updateActiveClone(cloneUrl, null)
        return
      }
      this.parallelCloneBatch.delete(cloneUrl)
      this.updateActiveClone(cloneUrl, {
        repository: item,
        path,
        error: 'Clone failed. Check your connection and try again.',
      })
      return
    }

    const wasParallelClone =
      this.parallelCloneBatch.delete(cloneUrl) ||
      Array.from(this.cloneStartRequests).some(url => url !== cloneUrl)
    this.updateActiveClone(cloneUrl, null)
    if (!wasParallelClone) {
      await this.openFirstCommit(repository)
    }
  }

  private getCloneDestinationError(
    cloneUrl: string,
    path: string
  ): string | null {
    const activeDestinations = [
      ...this.props.repositories,
      ...Array.from(this.state.activeClones.entries())
        .filter(([url]) => url !== cloneUrl)
        .map(([, clone]) => clone),
      ...Array.from(this.cloneDestinationReservations.entries())
        .filter(([url]) => url !== cloneUrl)
        .map(([, reservedPath]) => ({ path: reservedPath })),
    ]
    return matchExistingRepository(activeDestinations, path) === undefined
      ? null
      : 'The destination folder is already being used by another repository.'
  }

  private updateActiveClone(
    cloneUrl: string,
    activeClone: IActiveClone | null,
    callback?: () => void
  ) {
    this.setState(state => {
      const activeClones = new Map(state.activeClones)
      if (activeClone === null) {
        activeClones.delete(cloneUrl)
      } else {
        activeClones.set(cloneUrl, activeClone)
      }
      return { activeClones }
    }, callback)
  }

  private findCloningRepository(cloneUrl: string): CloningRepository | null {
    const activeClone = this.state.activeClones.get(cloneUrl)
    return (this.props.repositories.find(
      repository =>
        repository instanceof CloningRepository &&
        repository.url === cloneUrl &&
        (activeClone === undefined || repository.path === activeClone.path)
    ) ?? null) as CloningRepository | null
  }

  private cancelClone = (event: React.MouseEvent<HTMLButtonElement>) => {
    const cloneUrl = event.currentTarget.id
    const cloningRepository = this.findCloningRepository(cloneUrl)
    if (cloningRepository !== null) {
      this.cloneCancellationRequests.add(cloneUrl)
      this.props.dispatcher.cancelClone(cloningRepository)
    }
  }

  private chooseCloneLocation = async (item: IAPIRepositorySearchItem) => {
    const parent = await showOpenDialog({
      properties: ['createDirectory', 'openDirectory'],
    })
    if (parent === null) {
      return
    }
    const safeName = sanitizeCloneName(item.name)
    if (safeName !== null) {
      this.updateActiveClone(item.clone_url, null, () =>
        this.cloneAndRead(item, Path.join(parent, safeName))
      )
    }
  }

  private retryClone = (item: IAPIRepositorySearchItem, path: string) => {
    this.updateActiveClone(item.clone_url, null, () =>
      this.cloneAndRead(item, path)
    )
  }

  private retryActiveClone = (event: React.MouseEvent<HTMLButtonElement>) => {
    const activeClone = this.state.activeClones.get(event.currentTarget.id)
    if (activeClone !== undefined) {
      this.retryClone(activeClone.repository, activeClone.path)
    }
  }

  private chooseActiveCloneLocation = (
    event: React.MouseEvent<HTMLButtonElement>
  ) => {
    const activeClone = this.state.activeClones.get(event.currentTarget.id)
    if (activeClone !== undefined) {
      this.chooseCloneLocation(activeClone.repository)
    }
  }

  private onRepositoryLinkClicked = (
    event: React.MouseEvent<HTMLButtonElement>
  ) => {
    const url = event.currentTarget.dataset.url ?? event.currentTarget.id
    if (url.length > 0) {
      this.props.dispatcher.openInBrowser(url)
    }
  }

  private onTopicClicked = (event: React.MouseEvent<HTMLButtonElement>) => {
    const topic = event.currentTarget.dataset.topic
    if (topic !== undefined) {
      this.openTopic(topic)
    }
  }

  private onCloneAndReadClicked = (
    event: React.MouseEvent<HTMLButtonElement>
  ) => {
    const cloneUrl = event.currentTarget.id
    const item = this.state.repositoryResults?.items.find(
      candidate => candidate.clone_url === cloneUrl
    )
    if (item !== undefined) {
      this.cloneAndRead(item)
    }
  }

  private onPaginationClicked = (
    event: React.MouseEvent<HTMLButtonElement>
  ) => {
    const [kind, pageText] = event.currentTarget.id.split(':')
    const page = Number(pageText)
    if (!Number.isInteger(page) || page < 1) {
      return
    }

    if (kind === ExplorerPage.Search) {
      this.searchRepositories(page)
    } else if (kind === ExplorerPage.Tags) {
      this.searchTopics(page)
    }
  }

  private retryRepositorySearch = () =>
    this.searchRepositories(this.state.repositoryPage)

  private retryTopicSearch = () => this.searchTopics(this.state.topicPage)

  private signInToGitHub = () => {
    this.props.dispatcher.showDotComSignInDialog()
  }

  private getCloneProgress(item: IAPIRepositorySearchItem) {
    const cloningRepository = this.findCloningRepository(item.clone_url)
    if (cloningRepository !== null) {
      const progress = this.props.cloningRepositoryStateLookup.get(
        cloningRepository.id
      )
      if (progress !== undefined) {
        return progress
      }
    }

    const selectedState = this.props.selectedState
    if (
      selectedState?.type === SelectionType.CloningRepository &&
      selectedState.repository.url === item.clone_url
    ) {
      return selectedState.progress
    }
    return null
  }

  private renderRepositoryCard = (item: IAPIRepositorySearchItem) => {
    const local = this.findLocalRepository(item)
    const activeClone = this.state.activeClones.get(item.clone_url)
    const isActive =
      activeClone !== undefined ||
      this.findCloningRepository(item.clone_url) !== null
    const progress = this.getCloneProgress(item)
    const description = item.description ?? 'No repository description.'

    return (
      <article className="explorer-repository-card" key={item.html_url}>
        <div className="explorer-card-heading">
          <img src={item.owner.avatar_url} width={24} height={24} alt="" />
          <button
            className="explorer-repository-link"
            data-url={item.html_url}
            onClick={this.onRepositoryLinkClicked}
          >
            <span>{item.owner.login}/</span>
            <strong>{item.name}</strong>
          </button>
          {item.private && <span className="explorer-badge">Private</span>}
          {item.archived && <span className="explorer-badge">Archived</span>}
        </div>
        <p className="explorer-description">{description}</p>
        <div className="explorer-meta">
          <span>
            <Octicon symbol={octicons.star} />{' '}
            {item.stargazers_count.toLocaleString()}
          </span>
          {item.language !== null && <span>{item.language}</span>}
          <span>{new Date(item.updated_at).toLocaleDateString()}</span>
        </div>
        <div className="explorer-card-topics">
          {item.topics.slice(0, 4).map(topic => (
            <button
              key={topic}
              data-topic={topic}
              onClick={this.onTopicClicked}
            >
              {topic}
            </button>
          ))}
          {item.topics.length > 4 && <span>+{item.topics.length - 4}</span>}
        </div>
        <div className="explorer-card-footer">
          {activeClone !== undefined && activeClone.error !== null ? (
            <div className="explorer-clone-error">
              <span>{activeClone.error}</span>
              <div>
                <Button
                  size="small"
                  id={item.clone_url}
                  onClick={this.retryActiveClone}
                >
                  Retry
                </Button>
                <Button
                  size="small"
                  id={item.clone_url}
                  onClick={this.chooseActiveCloneLocation}
                >
                  Choose location…
                </Button>
              </div>
            </div>
          ) : isActive ? (
            <div className="explorer-clone-progress">
              <div className="explorer-progress-label">
                <span>{progress?.description ?? 'Starting clone…'}</span>
                <span>
                  {progress === null
                    ? ''
                    : `${Math.round(progress.value * 100)}%`}
                </span>
              </div>
              <div className="explorer-clone-progress-actions">
                <div className="explorer-progress-track">
                  <div
                    style={{ transform: `scaleX(${progress?.value ?? 0.05})` }}
                  />
                </div>
                <Button
                  size="small"
                  id={item.clone_url}
                  onClick={this.cancelClone}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button
              className="button-component-primary"
              id={item.clone_url}
              onClick={this.onCloneAndReadClicked}
            >
              {local === null ? 'Clone & Read' : 'Open First Commit'}
            </Button>
          )}
          <Button
            className="explorer-external-button"
            ariaLabel={`View ${item.owner.login}/${item.name} on GitHub`}
            tooltip="View on GitHub"
            id={item.html_url}
            onClick={this.onRepositoryLinkClicked}
          >
            <Octicon symbol={octicons.linkExternal} />
          </Button>
        </div>
      </article>
    )
  }

  private renderPagination(
    page: number,
    total: number,
    pageSize: number,
    kind: ExplorerPage
  ) {
    const lastPage = Math.min(
      Math.ceil(total / pageSize),
      Math.ceil(1000 / pageSize)
    )
    if (lastPage <= 1) {
      return null
    }
    const start = Math.max(1, Math.min(page - 2, lastPage - 4))
    const pages = Array.from(
      { length: Math.min(5, lastPage) },
      (_, index) => start + index
    )
    return (
      <nav className="explorer-pagination" aria-label="Search result pages">
        <Button
          disabled={page === 1}
          id={`${kind}:${page - 1}`}
          onClick={this.onPaginationClicked}
        >
          Previous
        </Button>
        {pages.map(value => (
          <Button
            key={value}
            className={value === page ? 'selected' : undefined}
            ariaLabel={`Page ${value}`}
            id={`${kind}:${value}`}
            onClick={this.onPaginationClicked}
          >
            {value}
          </Button>
        ))}
        <Button
          disabled={page === lastPage}
          id={`${kind}:${page + 1}`}
          onClick={this.onPaginationClicked}
        >
          Next
        </Button>
      </nav>
    )
  }

  private renderPopularTopics() {
    const topics = this.state.popularTopics?.slice(0, 24) ?? null

    return (
      <aside className="explorer-popular-topics">
        <div className="explorer-popular-topics-heading">
          <h3>Popular tags</h3>
          <button onClick={this.showTagsPage}>All tags</button>
        </div>
        <div
          className="explorer-popular-topics-scroll"
          ref={this.popularTopicsScrollRef}
          onScroll={this.onPopularTopicsScroll}
        >
          {this.state.loadingPopularTopics && topics === null ? (
            <div className="explorer-popular-topic-skeletons">
              {Array.from({ length: 16 }, (_, index) => (
                <span key={index} />
              ))}
            </div>
          ) : topics === null ? (
            <p className="explorer-popular-topics-unavailable">
              Tags are temporarily unavailable.
            </p>
          ) : (
            <ol>
              {topics.map(topic => {
                const name = topic.display_name ?? topic.name
                const count = topic.stargazer_count
                return (
                  <li key={topic.name}>
                    <button
                      className={
                        this.state.selectedTopic === topic.name
                          ? 'selected'
                          : undefined
                      }
                      aria-label={`${name}, ${
                        count?.toLocaleString() ?? 'unknown'
                      } followers`}
                      data-topic={topic.name}
                      onClick={this.onTopicClicked}
                    >
                      <span>{name}</span>
                      <span>{count?.toLocaleString() ?? '—'}</span>
                    </button>
                  </li>
                )
              })}
            </ol>
          )}
        </div>
      </aside>
    )
  }

  private renderSearchPage() {
    const results = this.state.repositoryResults
    const message =
      results === null
        ? null
        : `${results.total_count.toLocaleString()} repositories found`

    return (
      <div className="explorer-search-layout">
        {this.renderPopularTopics()}
        <section className="explorer-search-page" ref={this.searchResultsRef}>
          <div className="explorer-search-controls">
            <TextBox
              className="explorer-search-box"
              type="search"
              autoFocus={true}
              value={this.state.repositoryDraft}
              placeholder="Search GitHub repositories…"
              prefixedIcon={octicons.search}
              displayClearButton={true}
              ariaLabel="Search GitHub repositories"
              onValueChanged={this.onRepositoryQueryChanged}
              onEnterPressed={this.searchRepositoriesFirstPage}
              onSearchCleared={this.clearRepositorySearch}
            />
            <Select
              value={this.state.repositorySort}
              onChange={this.onRepositorySortChanged}
            >
              <option value={ExplorerRepositorySort.BestMatch}>
                Best match
              </option>
              <option value={ExplorerRepositorySort.Stars}>Most stars</option>
              <option value={ExplorerRepositorySort.Updated}>
                Recently updated
              </option>
            </Select>
          </div>
          {this.state.selectedTopic !== null && (
            <div className="explorer-active-topic">
              Topic: <strong>{this.state.selectedTopic}</strong>
              <Button size="small" onClick={this.clearTopic}>
                Clear
              </Button>
            </div>
          )}
          {this.state.error !== null &&
            this.renderError(this.retryRepositorySearch)}
          {this.state.loadingRepositories && results === null ? (
            this.renderSkeletons()
          ) : results === null ? (
            <div className="explorer-empty-state">
              <Octicon symbol={octicons.search} />
              <h2>Find a repository to read</h2>
              <p>Search by project, owner, technology, or GitHub topic.</p>
            </div>
          ) : results.items.length === 0 ? (
            <div className="explorer-empty-state">
              <h2>No repositories found</h2>
              <p>Try a broader query or clear the topic filter.</p>
            </div>
          ) : (
            <>
              <div className="explorer-results-summary">{message}</div>
              <div className="explorer-card-grid">
                {results.items.map(this.renderRepositoryCard)}
              </div>
              {this.renderPagination(
                this.state.repositoryPage,
                results.total_count,
                RepositoryPageSize,
                ExplorerPage.Search
              )}
            </>
          )}
          <AriaLiveContainer
            message={message}
            trackedUserInput={this.state.repositoryQuery}
          />
        </section>
      </div>
    )
  }

  private renderTagsPage() {
    const results = this.state.topicResults
    const message =
      results === null
        ? null
        : `${results.total_count.toLocaleString()} topics found`
    return (
      <div className="explorer-tags-layout">
        <section className="explorer-tag-cloud" aria-label="GitHub topics">
          <div className="explorer-section-heading">
            <div>
              <h2>GitHub Topics</h2>
              <p>Choose a topic to browse matching repositories.</p>
            </div>
            {results !== null && <span>{message}</span>}
          </div>
          {this.state.error !== null && this.renderError(this.retryTopicSearch)}
          {this.state.loadingTopics && results === null ? (
            this.renderTagSkeletons()
          ) : results === null ? null : (
            <div className="explorer-topic-links">
              {results.items.map(topic => (
                <button
                  key={topic.name}
                  className={`topic-${topicSizeTier(topic, results.items)}`}
                  aria-label={topic.short_description ?? topic.name}
                  data-topic={topic.name}
                  onClick={this.onTopicClicked}
                >
                  {topic.display_name ?? topic.name}
                </button>
              ))}
            </div>
          )}
          {results !== null &&
            this.renderPagination(
              this.state.topicPage,
              results.total_count,
              TopicPageSize,
              ExplorerPage.Tags
            )}
        </section>
        <aside className="explorer-tag-controls">
          <h3>Tag search</h3>
          <TextBox
            type="search"
            value={this.state.topicDraft}
            placeholder="Search all topics"
            prefixedIcon={octicons.search}
            displayClearButton={true}
            ariaLabel="Search GitHub topics"
            onValueChanged={this.onTopicQueryChanged}
            onEnterPressed={this.searchTopicsFirstPage}
            onSearchCleared={this.clearTopicSearch}
          />
          <Select
            label="Topic type"
            value={this.state.topicFilter}
            onChange={this.onTopicFilterChanged}
          >
            <option value={ExplorerTopicFilter.All}>All</option>
            <option value={ExplorerTopicFilter.Featured}>Featured</option>
            <option value={ExplorerTopicFilter.Curated}>Curated</option>
          </Select>
        </aside>
        <AriaLiveContainer
          message={message}
          trackedUserInput={this.state.topicQuery}
        />
      </div>
    )
  }

  private renderError(retry: () => void) {
    return (
      <div className="explorer-error" role="alert">
        <span>{this.state.error}</span>
        <Button size="small" onClick={retry}>
          Retry
        </Button>
      </div>
    )
  }

  private renderSkeletons() {
    return (
      <div className="explorer-card-grid explorer-skeleton-grid">
        {Array.from({ length: 9 }, (_, i) => (
          <div className="explorer-card-skeleton" key={i} />
        ))}
      </div>
    )
  }

  private renderTagSkeletons() {
    return (
      <div className="explorer-topic-links explorer-topic-skeletons">
        {Array.from({ length: 32 }, (_, i) => (
          <span key={i} />
        ))}
      </div>
    )
  }

  public render() {
    if (this.account === null) {
      return (
        <div className="explorer-view">
          <div className="explorer-empty-state">
            <Octicon symbol={octicons.markGithub} />
            <h2>Sign in to explore GitHub</h2>
            <p>
              Explorer uses your authenticated GitHub account for repository and
              topic search.
            </p>
            <Button
              className="button-component-primary explorer-sign-in-button"
              onClick={this.signInToGitHub}
              autoFocus={true}
            >
              Sign in to GitHub
            </Button>
          </div>
        </div>
      )
    }

    return (
      <main className="explorer-view">
        <nav className="explorer-page-tabs" aria-label="Explorer pages">
          <button
            className={
              this.state.page === ExplorerPage.Search ? 'selected' : undefined
            }
            onClick={this.showSearchPage}
          >
            Search
          </button>
          <button
            className={
              this.state.page === ExplorerPage.Tags ? 'selected' : undefined
            }
            onClick={this.showTagsPage}
          >
            Tags
          </button>
        </nav>
        <div className="explorer-page-content">
          {this.state.page === ExplorerPage.Search
            ? this.renderSearchPage()
            : this.renderTagsPage()}
        </div>
      </main>
    )
  }
}
