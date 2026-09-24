import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
const require = createRequire(import.meta.url)
const { createPinia, disposePinia } = require('pinia')
const ts = require('typescript')
function store(t, name, api, account = 'a') {
  const pinia = createPinia()
  t.after(() => disposePinia(pinia))
  let current = account
  const previous = globalThis.localStorage
  globalThis.localStorage = { getItem: () => current }
  t.after(() => { globalThis.localStorage = previous })
  const source = readFileSync(new URL(`../src/stores/${name}.ts`, import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } })
  const module = { exports: {} }
  new Function('require', 'module', 'exports', outputText)(id => id === '@/api' ? { __esModule: true, default: api, getApiErrorMessage: value => value?.message || 'error' } : require(id), module, module.exports)
  return { value: module.exports[name === 'commerce' ? 'useCommerceStore' : 'useActivityCenterStore'](pinia), select: id => current = id }
}
test('new activity directory bindings survive normalization as independent pages', async (t) => {
  const { value } = store(t, 'activity-center', { get: async () => ({ data: { ok: true, data: { activities: ['wish', 'happy'].map((key, i) => ({ id: String(2026092400 + i * 100), name: key, gameplayKey: key, detailTarget: key, gameplayTargets: [key] })) } } }) })
  await value.refresh('a')
  assert.deepEqual(value.activities.map(a => a.gameplayKey), ['wish', 'happy'])
  assert.deepEqual(value.activities.map(a => a.detailTarget), ['wish', 'happy'])
})
test('switching mall tabs or accounts clears stale catalog and ignores delayed replies', async (t) => {
  const requests = []
  const { value, select } = store(t, 'commerce', { get: (_url, options) => new Promise(resolve => requests.push({ options, resolve })) })
  const reply = (index, slot, marker) => requests[index].resolve({ data: { ok: true, data: { slotType: slot, currencies: [], goods: [], marker } } })
  const initial = value.fetchMall('a', 1); reply(0, 1, 'normal'); await initial
  const svip = value.fetchMall('a', 4)
  assert.equal(value.mall, null)
  const normal = value.fetchMall('a', 1); reply(2, 1, 'new'); await normal
  reply(1, 4, 'old'); await svip
  assert.equal(value.mall.marker, 'new')
  select('b'); const other = value.fetchMall('b', 1)
  assert.equal(value.mall, null)
  reply(3, 1, 'b'); await other
  assert.equal(value.mall.marker, 'b')
})

test('switching between merchant and mall ignores delayed replies and clears inactive loading', async (t) => {
  const requests = []
  const { value } = store(t, 'commerce', { get: url => new Promise(resolve => requests.push({ url, resolve })) })
  const merchant = value.fetchMystery('a')
  const mall = value.fetchMall('a', 1)
  assert.equal(value.mysteryLoading, false)
  requests[1].resolve({ data: { ok: true, data: { slotType: 1, currencies: [], goods: [] } } })
  await mall
  requests[0].resolve({ data: { ok: true, data: { active: true, npc: { id: 1 } } } })
  await merchant
  assert.equal(value.mystery, null)
  assert.equal(value.mallLoading, false)

  const oldMall = value.fetchMall('a', 4)
  const currentMerchant = value.fetchMystery('a')
  assert.equal(value.mallLoading, false)
  requests[3].resolve({ data: { ok: true, data: { active: true, npc: { id: 2 } } } })
  await currentMerchant
  requests[2].resolve({ data: { ok: false, error: 'stale mall error' } })
  await oldMall
  assert.equal(value.mystery.npc.id, 2)
  assert.equal(value.error, '')
  assert.equal(value.mysteryLoading, false)
})

test('merchant clears previous account goods and invalidates pending loads on reset', async (t) => {
  const requests = []
  const { value, select } = store(t, 'commerce', { get: () => new Promise(resolve => requests.push(resolve)) })
  const initial = value.fetchMystery('a')
  requests[0]({ data: { ok: true, data: { active: true, npc: { id: 1 } } } })
  await initial
  select('b')
  const next = value.fetchMystery('b')
  assert.equal(value.mystery, null)
  value.reset()
  assert.equal(value.mysteryLoading, false)
  requests[1]({ data: { ok: true, data: { active: true, npc: { id: 2 } } } })
  await next
  assert.equal(value.mystery, null)
})
