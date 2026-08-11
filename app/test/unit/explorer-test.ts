import { describe, it } from 'node:test'
import assert from 'node:assert'
import { IAPITopicSearchItem } from '../../src/lib/api'
import {
  buildRepositorySearchQuery,
  buildTopicSearchQuery,
  ExplorerTopicFilter,
  rankTopics,
  topicSizeTier,
} from '../../src/lib/explorer'

const topic = (name: string, score: number): IAPITopicSearchItem => ({
  name,
  display_name: null,
  short_description: null,
  featured: false,
  curated: false,
  score,
})

describe('Explorer', () => {
  it('combines general repository text with a selected topic', () => {
    assert.equal(
      buildRepositorySearchQuery('  desktop app  ', 'electron'),
      'desktop app topic:electron'
    )
    assert.equal(buildRepositorySearchQuery('', 'electron'), 'topic:electron')
    assert.equal(buildRepositorySearchQuery('desktop', null), 'desktop')
  })

  it('uses no invalid qualifier for an empty all-topics search', () => {
    assert.equal(buildTopicSearchQuery('', ExplorerTopicFilter.All), '')
    assert.equal(
      buildTopicSearchQuery('react', ExplorerTopicFilter.Featured),
      'react is:featured'
    )
    assert.equal(
      buildTopicSearchQuery('react', ExplorerTopicFilter.Curated),
      'react is:curated'
    )
  })

  it('ranks searched topic matches before higher-scoring unrelated topics', () => {
    const ranked = rankTopics(
      [
        topic('unrelated', 100),
        topic('react-native', 10),
        topic('preact', 20),
        topic('react', 1),
      ],
      'react'
    )

    assert.deepEqual(
      ranked.map(x => x.name),
      ['react', 'react-native', 'preact', 'unrelated']
    )
  })

  it('orders equally matched topics by real popularity when available', () => {
    const lessPopular = { ...topic('react-query', 100), stargazer_count: 10 }
    const morePopular = { ...topic('react-native', 1), stargazer_count: 200 }

    assert.deepEqual(
      rankTopics([lessPopular, morePopular], 'react').map(x => x.name),
      ['react-native', 'react-query']
    )
  })

  it('assigns topic size tiers from relative API scores', () => {
    const topics = [topic('small', 0), topic('medium', 50), topic('large', 100)]
    assert.equal(topicSizeTier(topics[0], topics), 'small')
    assert.equal(topicSizeTier(topics[1], topics), 'medium')
    assert.equal(topicSizeTier(topics[2], topics), 'large')
  })
})
