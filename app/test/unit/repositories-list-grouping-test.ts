import { describe, it } from 'node:test'
import assert from 'node:assert'
import { groupRepositories } from '../../src/ui/repositories-list/group-repositories'
import { Repository, ILocalRepositoryState } from '../../src/models/repository'
import { CloningRepository } from '../../src/models/cloning-repository'
import { gitHubRepoFixture } from '../helpers/github-repo-builder'

describe('repository list grouping', () => {
  const repositories: Array<Repository | CloningRepository> = [
    new Repository('repo1', 1, null, false),
    new Repository(
      'repo2',
      2,
      gitHubRepoFixture({ owner: 'me', name: 'my-repo2' }),
      false
    ),
    new Repository(
      'repo3',
      3,
      gitHubRepoFixture({
        owner: '',
        name: 'my-repo3',
        endpoint: 'https://github.big-corp.com/api/v3',
      }),
      false
    ),
  ]

  const cache = new Map<number, ILocalRepositoryState>()

  const paths = (
    items: ReturnType<typeof groupRepositories>[number]['items']
  ) => items.map(item => item.repository.path)

  it('groups repositories by owners/Enterprise/Other', () => {
    const grouped = groupRepositories(repositories, cache, [], null)
    assert.equal(grouped.length, 3)

    assert.equal(grouped[0].identifier.kind, 'dotcom')
    assert.equal((grouped[0].identifier as any).owner.login, 'me')
    assert.equal(grouped[0].items.length, 1)

    let item = grouped[0].items[0]
    assert.equal(item.repository.path, 'repo2')

    assert.equal(grouped[1].identifier.kind, 'enterprise')
    assert.equal(grouped[1].items.length, 1)

    item = grouped[1].items[0]
    assert.equal(item.repository.path, 'repo3')

    assert.equal(grouped[2].identifier.kind, 'other')
    assert.equal(grouped[2].items.length, 1)

    item = grouped[2].items[0]
    assert.equal(item.repository.path, 'repo1')
  })

  it('sorts repositories alphabetically within each group', () => {
    const repoA = new Repository('a', 1, null, false)
    const repoB = new Repository(
      'b',
      2,
      gitHubRepoFixture({ owner: 'me', name: 'b' }),
      false
    )
    const repoC = new Repository('c', 2, null, false)
    const repoD = new Repository(
      'd',
      2,
      gitHubRepoFixture({ owner: 'me', name: 'd' }),
      false
    )
    const repoZ = new Repository('z', 3, null, false)

    const grouped = groupRepositories(
      [repoC, repoB, repoZ, repoD, repoA],
      cache,
      [],
      null
    )
    assert.equal(grouped.length, 2)

    assert.equal(grouped[0].identifier.kind, 'dotcom')
    assert.equal((grouped[0].identifier as any).owner.login, 'me')
    assert.equal(grouped[0].items.length, 2)

    let items = grouped[0].items
    assert.equal(items[0].repository.path, 'b')
    assert.equal(items[1].repository.path, 'd')

    assert.equal(grouped[1].identifier.kind, 'other')
    assert.equal(grouped[1].items.length, 3)

    items = grouped[1].items
    assert.equal(items[0].repository.path, 'a')
    assert.equal(items[1].repository.path, 'c')
    assert.equal(items[2].repository.path, 'z')
  })

  it('only disambiguates Enterprise repositories', () => {
    const repoA = new Repository(
      'repo',
      1,
      gitHubRepoFixture({ owner: 'user1', name: 'repo' }),
      false
    )
    const repoB = new Repository(
      'repo',
      2,
      gitHubRepoFixture({ owner: 'user2', name: 'repo' }),
      false
    )
    const repoC = new Repository(
      'enterprise-repo',
      3,
      gitHubRepoFixture({
        owner: 'business',
        name: 'enterprise-repo',
        endpoint: 'https://ghe.io/api/v3',
      }),
      false
    )
    const repoD = new Repository(
      'enterprise-repo',
      3,
      gitHubRepoFixture({
        owner: 'silliness',
        name: 'enterprise-repo',
        endpoint: 'https://ghe.io/api/v3',
      }),
      false
    )

    const grouped = groupRepositories(
      [repoA, repoB, repoC, repoD],
      cache,
      [],
      null
    )
    assert.equal(grouped.length, 3)

    assert.equal(grouped[0].identifier.kind, 'dotcom')
    assert.equal((grouped[0].identifier as any).owner.login, 'user1')
    assert.equal(grouped[0].items.length, 1)

    assert.equal(grouped[1].identifier.kind, 'dotcom')
    assert.equal((grouped[1].identifier as any).owner.login, 'user2')
    assert.equal(grouped[1].items.length, 1)

    assert.equal(grouped[2].identifier.kind, 'enterprise')
    assert.equal(grouped[2].items.length, 2)

    assert.equal(grouped[0].items[0].text[0], 'repo')
    assert(!grouped[0].items[0].needsDisambiguation)

    assert.equal(grouped[1].items[0].text[0], 'repo')
    assert(!grouped[1].items[0].needsDisambiguation)

    assert.equal(grouped[2].items[0].text[0], 'enterprise-repo')
    assert(grouped[2].items[0].needsDisambiguation)

    assert.equal(grouped[2].items[1].text[0], 'enterprise-repo')
    assert(grouped[2].items[1].needsDisambiguation)
  })

  it('sorts the current and recently viewed repositories before alphabetical repositories', () => {
    const repoAlpha = new Repository('alpha', 1, null, false)
    const repoBravo = new Repository('bravo', 2, null, false)
    const repoCharlie = new Repository('charlie', 3, null, false)
    const repoDelta = new Repository('delta', 4, null, false)
    const repoEcho = new Repository('echo', 5, null, false)

    const grouped = groupRepositories(
      [repoBravo, repoEcho, repoCharlie, repoAlpha, repoDelta],
      cache,
      [4, 5, 2, 4, 999],
      5
    )

    assert.equal(grouped.length, 1)
    assert.deepEqual(paths(grouped[0].items), [
      'echo',
      'delta',
      'bravo',
      'alpha',
      'charlie',
    ])
  })

  it('applies recent ordering independently within each repository group', () => {
    const dotcomBravo = new Repository(
      'bravo',
      1,
      gitHubRepoFixture({ owner: 'me', name: 'bravo' }),
      false
    )
    const dotcomDelta = new Repository(
      'delta',
      2,
      gitHubRepoFixture({ owner: 'me', name: 'delta' }),
      false
    )
    const otherAlpha = new Repository('alpha', 3, null, false)
    const otherZulu = new Repository('zulu', 4, null, false)

    const grouped = groupRepositories(
      [dotcomBravo, otherAlpha, dotcomDelta, otherZulu],
      cache,
      [2, 3, 1],
      4
    )

    assert.equal(grouped.length, 2)
    assert.equal(grouped[0].identifier.kind, 'dotcom')
    assert.deepEqual(paths(grouped[0].items), ['delta', 'bravo'])
    assert.equal(grouped[1].identifier.kind, 'other')
    assert.deepEqual(paths(grouped[1].items), ['zulu', 'alpha'])
  })

  it('sorts the existing Recent group by most recently viewed order', () => {
    const repositories = [
      new Repository('alpha', 1, null, false),
      new Repository('bravo', 2, null, false),
      new Repository('charlie', 3, null, false),
      new Repository('delta', 4, null, false),
      new Repository('echo', 5, null, false),
      new Repository('foxtrot', 6, null, false),
      new Repository('golf', 7, null, false),
      new Repository('zulu', 8, null, false),
    ]

    const grouped = groupRepositories(repositories, cache, [8, 1, 5], 4)

    assert.equal(grouped.length, 2)
    assert.equal(grouped[0].identifier.kind, 'recent')
    assert.deepEqual(paths(grouped[0].items), ['zulu', 'alpha', 'echo'])
    assert.equal(grouped[1].identifier.kind, 'other')
    assert.deepEqual(paths(grouped[1].items).slice(0, 4), [
      'delta',
      'zulu',
      'alpha',
      'echo',
    ])
  })
})
