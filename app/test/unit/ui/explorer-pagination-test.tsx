import assert from 'node:assert'
import { afterEach, describe, it } from 'node:test'
import * as React from 'react'

import {
  API,
  IAPIRepositorySearchItem,
  IAPISearchResponse,
  IAPITopicSearchItem,
} from '../../../src/lib/api'
import {
  ExplorerTopicCacheFreshDuration,
  setCachedExplorerTopics,
} from '../../../src/lib/explorer-topic-cache'
import {
  ExplorerPage,
  ExplorerRepositorySort,
  ExplorerTopicFilter,
} from '../../../src/lib/explorer'
import { Account } from '../../../src/models/account'
import { CloningRepository } from '../../../src/models/cloning-repository'
import { ICloneProgress } from '../../../src/models/progress'
import type { Dispatcher } from '../../../src/ui/dispatcher'
import { Explorer } from '../../../src/ui/explorer'
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '../../helpers/ui/render'

const originalFromAccount = API.fromAccount

if (globalThis.localStorage === undefined) {
  const values = new Map<string, string>()
  Object.assign(globalThis, {
    localStorage: {
      get length() {
        return values.size
      },
      clear: () => values.clear(),
      getItem: (key: string) => values.get(key) ?? null,
      key: (index: number) => Array.from(values.keys())[index] ?? null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, value),
    } as Storage,
  })
}

afterEach(() => {
  API.fromAccount = originalFromAccount
  localStorage.removeItem('last-clone-location')
  localStorage.clear()
})

function topic(name: string): IAPITopicSearchItem {
  return {
    name,
    display_name: null,
    short_description: null,
    featured: false,
    curated: false,
    score: 1,
    stargazer_count: 10,
  }
}

function topicResults(
  item: IAPITopicSearchItem
): IAPISearchResponse<IAPITopicSearchItem> {
  return {
    total_count: 1,
    incomplete_results: false,
    items: [item],
  }
}

function repository(name: string): IAPIRepositorySearchItem {
  return {
    clone_url: `https://github.com/octocat/${name}.git`,
    ssh_url: `git@github.com:octocat/${name}.git`,
    html_url: `https://github.com/octocat/${name}`,
    name,
    owner: {
      id: 1,
      login: 'octocat',
      avatar_url: '',
      html_url: 'https://github.com/octocat',
      type: 'User',
    },
    private: false,
    fork: false,
    default_branch: 'main',
    pushed_at: '2026-08-11T00:00:00Z',
    has_issues: true,
    archived: false,
    description: null,
    stargazers_count: 1,
    forks_count: 0,
    language: 'TypeScript',
    topics: [],
    updated_at: '2026-08-11T00:00:00Z',
  }
}

function results(
  items: IAPIRepositorySearchItem | ReadonlyArray<IAPIRepositorySearchItem>,
  totalCount: number = 90
): IAPISearchResponse<IAPIRepositorySearchItem> {
  return {
    total_count: totalCount,
    incomplete_results: false,
    items: Array.isArray(items) ? items : [items],
  }
}

describe('Explorer search and repository pagination', () => {
  it('keeps results while editing and searches only when Enter is pressed', async () => {
    const queries = new Array<string>()
    API.fromAccount = () =>
      ({
        searchRepositories: (query: string) => {
          queries.push(query)
          return Promise.resolve(results(repository(query), 1))
        },
      } as unknown as API)

    render(
      <Explorer
        accounts={[Account.anonymous()]}
        repositories={[]}
        cloningRepositoryStateLookup={new Map()}
        selectedState={null}
        dispatcher={{} as Dispatcher}
        initialSessionState={{
          page: ExplorerPage.Search,
          repositoryQuery: '',
          topicQuery: '',
          repositorySort: ExplorerRepositorySort.BestMatch,
          topicFilter: ExplorerTopicFilter.All,
          repositoryPage: 1,
          topicPage: 1,
          repositoryResults: null,
          topicResults: null,
          popularTopics: [],
          selectedTopic: null,
          popularTopicsScrollTop: 0,
        }}
        onSessionStateChanged={() => {}}
        onClose={() => {}}
      />
    )

    const input = screen.getByRole('searchbox', {
      name: 'Search GitHub repositories',
    }) as HTMLInputElement

    fireEvent.change(input, { target: { value: 'desktop' } })
    await new Promise(resolve => window.setTimeout(resolve, 350))
    assert.deepEqual(queries, [])

    fireEvent.keyDown(input, { key: 'Enter' })
    input.dispatchEvent(new Event('search'))
    await waitFor(() => assert.ok(screen.getByText('desktop')))
    assert.deepEqual(queries, ['desktop'])
    assert.equal(input.value, 'desktop')

    fireEvent.change(input, { target: { value: 'electron' } })
    await new Promise(resolve => window.setTimeout(resolve, 350))
    assert.deepEqual(queries, ['desktop'])
    assert.ok(screen.getByText('desktop'))

    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: ExplorerRepositorySort.Stars },
    })
    await waitFor(() => assert.deepEqual(queries, ['desktop', 'desktop']))
    assert.equal(input.value, 'electron')
    assert.ok(screen.getByText('desktop'))

    fireEvent.keyDown(input, { key: 'Enter' })
    input.dispatchEvent(new Event('search'))
    await waitFor(() => assert.ok(screen.getByText('electron')))
    assert.deepEqual(queries, ['desktop', 'desktop', 'electron'])
    assert.equal(input.value, 'electron')

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    await waitFor(() =>
      assert.ok(screen.getByText('Find a repository to read'))
    )
    assert.deepEqual(queries, ['desktop', 'desktop', 'electron'])
    assert.equal(input.value, '')
  })

  it('searches topics only when Enter is pressed', async () => {
    const queries = new Array<string>()
    const account = Account.anonymous()
    setCachedExplorerTopics(
      account.endpoint,
      { kind: 'popular' },
      topicResults(topic('initial'))
    )
    API.fromAccount = () =>
      ({
        searchTopics: (query: string) => {
          queries.push(query)
          return Promise.resolve(topicResults(topic(query)))
        },
        fetchTopicStargazerCounts: (names: ReadonlyArray<string>) =>
          Promise.resolve(new Map(names.map(name => [name, 10]))),
      } as unknown as API)

    render(
      <Explorer
        accounts={[account]}
        repositories={[]}
        cloningRepositoryStateLookup={new Map()}
        selectedState={null}
        dispatcher={{} as Dispatcher}
        initialSessionState={{
          page: ExplorerPage.Tags,
          repositoryQuery: '',
          topicQuery: '',
          repositorySort: ExplorerRepositorySort.BestMatch,
          topicFilter: ExplorerTopicFilter.All,
          repositoryPage: 1,
          topicPage: 1,
          repositoryResults: null,
          topicResults: topicResults(topic('initial')),
          popularTopics: [],
          selectedTopic: null,
          popularTopicsScrollTop: 0,
        }}
        onSessionStateChanged={() => {}}
        onClose={() => {}}
      />
    )

    const input = screen.getByRole('searchbox', {
      name: 'Search GitHub topics',
    }) as HTMLInputElement

    fireEvent.change(input, { target: { value: 'mcp' } })
    await new Promise(resolve => window.setTimeout(resolve, 350))
    assert.deepEqual(queries, [])
    assert.ok(screen.getByRole('button', { name: 'initial' }))

    fireEvent.keyDown(input, { key: 'Enter' })
    input.dispatchEvent(new Event('search'))
    await waitFor(() => assert.ok(screen.getByRole('button', { name: 'mcp' })))
    assert.deepEqual(queries, ['mcp'])
    assert.equal(input.value, 'mcp')

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    await waitFor(() =>
      assert.ok(screen.getByRole('button', { name: 'initial' }))
    )
    assert.deepEqual(queries, ['mcp'])
    assert.equal(input.value, '')
  })

  it('shares an in-flight prefetched page with a pagination click', async () => {
    const requestedPages = new Array<number>()
    let resolveSecondPage: (
      value: IAPISearchResponse<IAPIRepositorySearchItem>
    ) => void = () => {}
    const secondPage = new Promise<
      IAPISearchResponse<IAPIRepositorySearchItem>
    >(resolve => {
      resolveSecondPage = resolve
    })
    const fakeAPI = {
      searchRepositories: (_query: string, page: number) => {
        requestedPages.push(page)
        return page === 2
          ? secondPage
          : Promise.resolve(results(repository(`page-${page}`)))
      },
    }
    API.fromAccount = () => fakeAPI as unknown as API

    render(
      <Explorer
        accounts={[Account.anonymous()]}
        repositories={[]}
        cloningRepositoryStateLookup={new Map()}
        selectedState={null}
        dispatcher={{} as Dispatcher}
        initialSessionState={{
          page: ExplorerPage.Search,
          repositoryQuery: 'desktop',
          topicQuery: '',
          repositorySort: ExplorerRepositorySort.BestMatch,
          topicFilter: ExplorerTopicFilter.All,
          repositoryPage: 1,
          topicPage: 1,
          repositoryResults: results(repository('page-1')),
          topicResults: null,
          popularTopics: [],
          selectedTopic: null,
          popularTopicsScrollTop: 0,
        }}
        onSessionStateChanged={() => {}}
        onClose={() => {}}
      />
    )

    await waitFor(() => assert.deepEqual(requestedPages, [2]))

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    assert.deepEqual(requestedPages, [2])

    resolveSecondPage(results(repository('page-2')))
    await waitFor(() => assert.ok(screen.getByText('page-2')))
    assert.ok(
      screen
        .getByRole('button', { name: 'Page 2' })
        .classList.contains('selected')
    )
  })

  it('renders a fresh popular-topic cache without an API request', async () => {
    const account = Account.anonymous()
    setCachedExplorerTopics(
      account.endpoint,
      { kind: 'popular' },
      topicResults(topic('python'))
    )
    let requestCount = 0
    API.fromAccount = () =>
      ({
        searchRepositories: () => {
          requestCount++
          return Promise.reject(new Error('Unexpected request'))
        },
      } as unknown as API)
    const sessionStates = new Array<{ popularTopicsScrollTop: number }>()

    const view = render(
      <Explorer
        accounts={[account]}
        repositories={[]}
        cloningRepositoryStateLookup={new Map()}
        selectedState={null}
        dispatcher={{} as Dispatcher}
        onSessionStateChanged={state => sessionStates.push(state)}
        onClose={() => {}}
      />
    )

    await waitFor(() => assert.ok(screen.getByText('python')))
    assert.equal(requestCount, 0)

    const tagScroller = view.container.querySelector(
      '.explorer-popular-topics-scroll'
    )
    const repositoryScroller = view.container.querySelector(
      '.explorer-search-page'
    )
    assert.ok(tagScroller instanceof HTMLDivElement)
    assert.ok(repositoryScroller instanceof HTMLElement)
    tagScroller.scrollTop = 80
    fireEvent.scroll(tagScroller)

    await waitFor(() =>
      assert.equal(
        sessionStates[sessionStates.length - 1]?.popularTopicsScrollTop,
        80
      )
    )
    assert.equal(repositoryScroller.scrollTop, 0)
  })

  it('shares one background refresh for stale popular topics', async () => {
    const account = Account.anonymous()
    setCachedExplorerTopics(
      account.endpoint,
      { kind: 'popular' },
      topicResults(topic('python')),
      Date.now() - ExplorerTopicCacheFreshDuration - 1
    )
    let resolveCatalog: (
      value: IAPISearchResponse<IAPIRepositorySearchItem>
    ) => void = () => {}
    const catalog = new Promise<IAPISearchResponse<IAPIRepositorySearchItem>>(
      resolve => {
        resolveCatalog = resolve
      }
    )
    let catalogRequests = 0
    let countRequests = 0
    API.fromAccount = () =>
      ({
        searchRepositories: () => {
          catalogRequests++
          return catalog
        },
        fetchTopicStargazerCounts: () => {
          countRequests++
          return Promise.resolve(new Map([['javascript', 20]]))
        },
      } as unknown as API)

    render(
      <Explorer
        accounts={[account]}
        repositories={[]}
        cloningRepositoryStateLookup={new Map()}
        selectedState={null}
        dispatcher={{} as Dispatcher}
        onSessionStateChanged={() => {}}
        onClose={() => {}}
      />
    )

    await waitFor(() => assert.ok(screen.getByText('python')))
    fireEvent.click(screen.getByRole('button', { name: 'Tags' }))
    assert.equal(catalogRequests, 1)

    resolveCatalog(
      results({ ...repository('catalog'), topics: ['javascript'] })
    )
    await waitFor(() =>
      assert.ok(screen.getByRole('button', { name: 'javascript' }))
    )
    assert.equal(catalogRequests, 1)
    assert.equal(countRequests, 1)
  })

  it('starts clones for different repository cards in parallel', async () => {
    const cloneRequests = new Array<{ url: string; path: string }>()
    const fakeDispatcher = {
      clone: (url: string, path: string) => {
        cloneRequests.push({ url, path })
        return new Promise<null>(() => {})
      },
    }
    const alpha = repository('parallel-alpha')
    const beta = repository('parallel-beta')
    localStorage.setItem(
      'last-clone-location',
      `/tmp/github-desktop-explorer-${process.pid}`
    )

    render(
      <Explorer
        accounts={[Account.anonymous()]}
        repositories={[]}
        cloningRepositoryStateLookup={new Map()}
        selectedState={null}
        dispatcher={fakeDispatcher as unknown as Dispatcher}
        initialSessionState={{
          page: ExplorerPage.Search,
          repositoryQuery: 'parallel',
          topicQuery: '',
          repositorySort: ExplorerRepositorySort.BestMatch,
          topicFilter: ExplorerTopicFilter.All,
          repositoryPage: 1,
          topicPage: 1,
          repositoryResults: results([alpha, beta], 2),
          topicResults: null,
          popularTopics: [],
          selectedTopic: null,
          popularTopicsScrollTop: 0,
        }}
        onSessionStateChanged={() => {}}
        onClose={() => {}}
      />
    )

    const alphaCard = screen
      .getByText('parallel-alpha', { selector: 'strong' })
      .closest('article')
    const betaCard = screen
      .getByText('parallel-beta', { selector: 'strong' })
      .closest('article')
    assert.notEqual(alphaCard, null)
    assert.notEqual(betaCard, null)

    fireEvent.click(
      within(alphaCard!).getByRole('button', { name: 'Clone & Read' })
    )
    await waitFor(() => assert.equal(cloneRequests.length, 1))

    const betaCloneButton = within(betaCard!).getByRole('button', {
      name: 'Clone & Read',
    })
    assert.equal(betaCloneButton.getAttribute('aria-disabled'), null)
    fireEvent.click(betaCloneButton)

    await waitFor(() => assert.equal(cloneRequests.length, 2))
    assert.equal(
      document.querySelectorAll('.explorer-clone-progress').length,
      2
    )
    assert.deepEqual(
      cloneRequests.map(request => request.url),
      [alpha.clone_url, beta.clone_url]
    )
  })

  it('shows and cancels concurrent clone progress independently', () => {
    const alpha = repository('progress-alpha')
    const beta = repository('progress-beta')
    const alphaClone = new CloningRepository(
      '/tmp/progress-alpha',
      alpha.clone_url
    )
    const betaClone = new CloningRepository(
      '/tmp/progress-beta',
      beta.clone_url
    )
    const cancelled = new Array<CloningRepository>()
    const progress = new Map<number, ICloneProgress>([
      [
        alphaClone.id,
        { kind: 'clone', value: 0.25, description: 'Receiving alpha' },
      ],
      [
        betaClone.id,
        { kind: 'clone', value: 0.75, description: 'Receiving beta' },
      ],
    ])

    render(
      <Explorer
        accounts={[Account.anonymous()]}
        repositories={[alphaClone, betaClone]}
        cloningRepositoryStateLookup={progress}
        selectedState={null}
        dispatcher={
          {
            cancelClone: (repository: CloningRepository) =>
              cancelled.push(repository),
          } as unknown as Dispatcher
        }
        initialSessionState={{
          page: ExplorerPage.Search,
          repositoryQuery: 'progress',
          topicQuery: '',
          repositorySort: ExplorerRepositorySort.BestMatch,
          topicFilter: ExplorerTopicFilter.All,
          repositoryPage: 1,
          topicPage: 1,
          repositoryResults: results([alpha, beta], 2),
          topicResults: null,
          popularTopics: [],
          selectedTopic: null,
          popularTopicsScrollTop: 0,
        }}
        onSessionStateChanged={() => {}}
        onClose={() => {}}
      />
    )

    assert.ok(screen.getByText('Receiving alpha'))
    assert.ok(screen.getByText('25%'))
    assert.ok(screen.getByText('Receiving beta'))
    assert.ok(screen.getByText('75%'))

    const alphaCard = screen
      .getByText('progress-alpha', { selector: 'strong' })
      .closest('article')
    assert.notEqual(alphaCard, null)
    fireEvent.click(within(alphaCard!).getByRole('button', { name: 'Cancel' }))
    assert.deepEqual(cancelled, [alphaClone])
  })

  it('prevents parallel clones from sharing the same destination', async () => {
    const cloneRequests = new Array<string>()
    const first = {
      ...repository('shared-name'),
      clone_url: 'https://github.com/first/shared-name.git',
      html_url: 'https://github.com/first/shared-name',
      owner: { ...repository('shared-name').owner, login: 'first' },
    }
    const second = {
      ...repository('shared-name'),
      clone_url: 'https://github.com/second/shared-name.git',
      html_url: 'https://github.com/second/shared-name',
      owner: { ...repository('shared-name').owner, login: 'second' },
    }
    localStorage.setItem(
      'last-clone-location',
      `/tmp/github-desktop-explorer-collision-${process.pid}`
    )

    render(
      <Explorer
        accounts={[Account.anonymous()]}
        repositories={[]}
        cloningRepositoryStateLookup={new Map()}
        selectedState={null}
        dispatcher={
          {
            clone: (url: string) => {
              cloneRequests.push(url)
              return new Promise<null>(() => {})
            },
          } as unknown as Dispatcher
        }
        initialSessionState={{
          page: ExplorerPage.Search,
          repositoryQuery: 'shared-name',
          topicQuery: '',
          repositorySort: ExplorerRepositorySort.BestMatch,
          topicFilter: ExplorerTopicFilter.All,
          repositoryPage: 1,
          topicPage: 1,
          repositoryResults: results([first, second], 2),
          topicResults: null,
          popularTopics: [],
          selectedTopic: null,
          popularTopicsScrollTop: 0,
        }}
        onSessionStateChanged={() => {}}
        onClose={() => {}}
      />
    )

    const firstCard = screen.getByText('first/').closest('article')
    const secondCard = screen.getByText('second/').closest('article')
    assert.notEqual(firstCard, null)
    assert.notEqual(secondCard, null)
    fireEvent.click(
      within(firstCard!).getByRole('button', { name: 'Clone & Read' })
    )
    await waitFor(() => assert.equal(cloneRequests.length, 1))
    fireEvent.click(
      within(secondCard!).getByRole('button', { name: 'Clone & Read' })
    )

    await waitFor(() =>
      assert.ok(
        within(secondCard!).getByText(
          'The destination folder is already being used by another repository.'
        )
      )
    )
    assert.deepEqual(cloneRequests, [first.clone_url])
  })
})
