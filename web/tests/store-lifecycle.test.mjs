import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(import.meta.url)
const { createPinia, disposePinia, setActivePinia } = require('pinia')
const { reactive, ref } = require('vue')
const ts = require('typescript')

// Run the real stores with Vue/Pinia; only external I/O and browser storage are replaced.
function harness(t, name, api) {
  const pinia = createPinia()
  setActivePinia(pinia)
  t.after(() => disposePinia(pinia))
  const account = reactive({ currentAccountId: 'a' })
  const imports = {
    '@/api': { __esModule: true, default: api, getApiErrorMessage: value => value?.error || value?.message || '请求失败' },
    '@/stores/account': { useAccountStore: () => account },
    '@vueuse/core': { useStorage: (_key, initial) => ref(initial) },
  }
  const source = readFileSync(new URL(`../src/stores/${name}.ts`, import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } })
  const module = { exports: {} }
  new Function('require', 'module', 'exports', outputText)(id => imports[id] || require(id), module, module.exports)
  const useStore = name === 'status' ? module.exports.useStatusStore : module.exports.usePetDiaryStore
  return { store: useStore(pinia), account }
}

test('daily tasks coalesce pending loads and discard replies across an account round trip', async (t) => {
  const requests = []
  const { store, account } = harness(t, 'status', {
    get: (_url, options) => new Promise(resolve => requests.push({ id: options.headers['x-account-id'], resolve })),
  })
  const oldA = store.fetchDailyGifts('a')
  const duplicate = store.fetchDailyGifts('a')
  assert.equal(requests.length, 1)
  assert.equal(store.dailyGiftsLoading, true)
  account.currentAccountId = 'b'
  const requestB = store.fetchDailyGifts('b')
  account.currentAccountId = 'a'
  const newA = store.fetchDailyGifts('a')
  requests[2].resolve({ data: { ok: true, data: { date: 'new-a', gifts: [] } } })
  await newA
  requests[1].resolve({ data: { ok: true, data: { date: 'old-b', gifts: [] } } })
  requests[0].resolve({ data: { ok: true, data: { date: 'old-a', gifts: [] } } })
  await Promise.all([oldA, duplicate, requestB])
  assert.equal(store.dailyGifts.date, 'new-a')
  assert.equal(store.dailyGiftsLoading, false)
  account.currentAccountId = ''
  assert.equal(store.dailyGifts, null)
})

test('a failed task load can be retried without leaving loading or error state behind', async (t) => {
  let failed = true
  const { store } = harness(t, 'status', {
    get: async () => failed ? { data: { ok: false, error: '临时断线' } } : { data: { ok: true, data: { date: 'today', gifts: [] } } },
  })
  await store.fetchDailyGifts('a')
  assert.equal(store.dailyGiftsError, '临时断线')
  assert.equal(store.dailyGiftsLoading, false)
  failed = false
  await store.fetchDailyGifts('a')
  assert.equal(store.dailyGifts.date, 'today')
  assert.equal(store.dailyGiftsError, '')
})

test('pet success feedback expires, newer feedback gets its full duration, and switching accounts clears it', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let message = '第一次成功'
  const { store } = harness(t, 'pet-diary', {
    post: async () => ({ data: { ok: true, data: { message, snapshot: { active: true } } } }),
  })
  store.selectAccount('a')
  store.activity = { active: true }
  await store.operate('refreshCharm')
  t.mock.timers.tick(3000)
  message = '第二次成功'
  await store.operate('equipCharm', { charmId: 101 })
  t.mock.timers.tick(1000)
  assert.equal(store.notice, '第二次成功')
  t.mock.timers.tick(3000)
  assert.equal(store.notice, '')
  await store.operate('refreshCharm')
  store.selectAccount('b')
  assert.equal(store.notice, '')
})

test('pet failure warnings stay visible after the success-feedback timeout', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { store } = harness(t, 'pet-diary', { post: async () => { throw new Error('余额不足') } })
  store.selectAccount('a')
  store.activity = { active: true }
  await store.operate('draw')
  t.mock.timers.tick(8000)
  assert.match(store.error, /余额不足/)
  assert.equal(store.stale, true)
})
