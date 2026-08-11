import { IAPITopicSearchItem, RepositorySearchSort } from './api'

export enum ExplorerPage {
  Search = 'search',
  Tags = 'tags',
}

export enum ExplorerRepositorySort {
  BestMatch = 'best-match',
  Stars = 'stars',
  Updated = 'updated',
}

export enum ExplorerTopicFilter {
  All = 'all',
  Featured = 'featured',
  Curated = 'curated',
}

export function getRepositorySearchSort(
  sort: ExplorerRepositorySort
): RepositorySearchSort | undefined {
  switch (sort) {
    case ExplorerRepositorySort.BestMatch:
      return undefined
    case ExplorerRepositorySort.Stars:
      return 'stars'
    case ExplorerRepositorySort.Updated:
      return 'updated'
  }
}

export function buildRepositorySearchQuery(
  query: string,
  topic: string | null
): string {
  const trimmed = query.trim()
  const parts = new Array<string>()

  if (trimmed.length > 0) {
    parts.push(trimmed)
  }
  if (topic !== null && topic.length > 0) {
    parts.push(`topic:${topic}`)
  }

  return parts.join(' ')
}

export function buildTopicSearchQuery(
  query: string,
  filter: ExplorerTopicFilter
): string {
  const parts = new Array<string>()
  const trimmed = query.trim()
  if (trimmed.length > 0) {
    parts.push(trimmed)
  }

  switch (filter) {
    case ExplorerTopicFilter.All:
      break
    case ExplorerTopicFilter.Featured:
      parts.push('is:featured')
      break
    case ExplorerTopicFilter.Curated:
      parts.push('is:curated')
      break
  }

  return parts.join(' ')
}

function topicMatchRank(name: string, query: string): number {
  if (query.length === 0) {
    return 3
  }

  const normalizedName = name.toLocaleLowerCase()
  if (normalizedName === query) {
    return 0
  }
  if (normalizedName.startsWith(query)) {
    return 1
  }
  if (normalizedName.includes(query)) {
    return 2
  }
  return 3
}

/** Put exact, prefix, and substring topic matches ahead of API relevance. */
export function rankTopics(
  topics: ReadonlyArray<IAPITopicSearchItem>,
  query: string
): ReadonlyArray<IAPITopicSearchItem> {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  return topics
    .map((topic, index) => ({ topic, index }))
    .sort((left, right) => {
      const rankDifference =
        topicMatchRank(left.topic.name, normalizedQuery) -
        topicMatchRank(right.topic.name, normalizedQuery)
      if (rankDifference !== 0) {
        return rankDifference
      }

      const scoreDifference =
        (right.topic.stargazer_count ?? right.topic.score) -
        (left.topic.stargazer_count ?? left.topic.score)
      return scoreDifference !== 0 ? scoreDifference : left.index - right.index
    })
    .map(x => x.topic)
}

export function topicSizeTier(
  topic: IAPITopicSearchItem,
  topics: ReadonlyArray<IAPITopicSearchItem>
): 'small' | 'medium' | 'large' {
  if (topics.length === 0) {
    return 'small'
  }

  const scores = topics.map(x => x.stargazer_count ?? x.score)
  const minimum = Math.min(...scores)
  const maximum = Math.max(...scores)
  if (maximum === minimum) {
    return 'medium'
  }

  const normalized =
    ((topic.stargazer_count ?? topic.score) - minimum) / (maximum - minimum)
  return normalized >= 0.67 ? 'large' : normalized >= 0.33 ? 'medium' : 'small'
}
