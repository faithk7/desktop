import assert from 'node:assert'
import { describe, it } from 'node:test'

import { getScrollTopForRowNearTop } from '../../src/ui/lib/list'

describe('list scrolling', () => {
  describe('getScrollTopForRowNearTop', () => {
    it('positions a fixed-height row with context above it', () => {
      assert.equal(getScrollTopForRowNearTop(8, 70, 1), 490)
    })

    it('clamps the context at the beginning of the list', () => {
      assert.equal(getScrollTopForRowNearTop(0, 70, 1), 0)
    })

    it('sums variable row heights through the first visible row', () => {
      const rowHeights = [30, 40, 50, 60]

      assert.equal(
        getScrollTopForRowNearTop(3, ({ index }) => rowHeights[index], 1),
        70
      )
    })
  })
})
