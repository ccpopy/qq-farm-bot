import assert from 'node:assert/strict'
// Node's built-in test runner keeps this regression suite dependency-free.
// eslint-disable-next-line test/no-import-node-test
import test from 'node:test'
import {
  bagMutationFailure,
  bagMutationTargetsApplied,
  normalizeBagMutationResponse,
} from '../src/utils/bag-mutation.js'

test('HTTP 500 keeps the backend reason and marks the mutation result uncertain', () => {
  const result = bagMutationFailure({
    message: 'Request failed with status code 500',
    response: {
      status: 500,
      data: { error: 'response serialization failed', traceId: 'bag-use-1' },
    },
  }, '使用失败')

  assert.deepEqual(result, {
    ok: false,
    error: 'response serialization failed',
    traceId: 'bag-use-1',
    status: 500,
    uncertain: true,
  })
})

test('an explicit preflight rejection is not treated as an uncertain mutation', () => {
  const result = bagMutationFailure({
    response: {
      status: 500,
      data: { error: '背包中未找到星砂' },
    },
  }, '出售失败')

  assert.equal(result.error, '背包中未找到星砂')
  assert.equal(result.uncertain, false)
})

test('worker timeout responses remain uncertain without retrying the mutation', () => {
  const result = normalizeBagMutationResponse({ ok: false, error: 'API Timeout' })
  assert.equal(result.ok, false)
  assert.equal(result.uncertain, true)
})

test('inventory reconciliation requires every requested stack to decrease', () => {
  const targets = [
    { id: 101351, uid: 11, beforeCount: 2, requestedCount: 1 },
    { id: 1023, uid: 12, beforeCount: 8, requestedCount: 8 },
  ]

  assert.equal(bagMutationTargetsApplied([
    { id: 101351, uid: 11, count: 1 },
  ], targets), true)
  assert.equal(bagMutationTargetsApplied([
    { id: 101351, uid: 11, count: 2 },
  ], targets), false)
  assert.equal(bagMutationTargetsApplied([], [
    { id: 101351, uid: 11, beforeCount: 0, requestedCount: 1 },
  ]), false)
})
