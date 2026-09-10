import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
// Match the repository's dependency-free test runner.
// eslint-disable-next-line test/no-import-node-test
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { createPinia, defineStore, disposePinia, setActivePinia } = require('pinia')
const ts = require('typescript')
const vue = require('vue')
const { compileScript, parse } = require('vue/compiler-sfc')

const compiled = new Map()

function loadSource(file, imports) {
  if (!compiled.has(file)) {
    let source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')
    if (file.endsWith('.vue')) {
      const { descriptor } = parse(source, { filename: file })
      source = compileScript(descriptor, { id: file }).content
    }
    compiled.set(file, ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText)
  }
  const module = { exports: {} }
  // Execute the real setup code while replacing browser I/O and visual child components.
  // eslint-disable-next-line no-new-func
  new Function('require', 'module', 'exports', compiled.get(file))((id) => {
    if (id in imports)
      return imports[id]
    if (id.startsWith('naive-ui/') || id.endsWith('.vue'))
      return {}
    if (id.startsWith('@/utils/'))
      return require(fileURLToPath(new URL(`../src/${id.slice(2)}`, import.meta.url)))
    return require(id)
  }, module, module.exports)
  return module.exports
}

async function settle() {
  await vue.nextTick()
  await Promise.resolve()
  await vue.nextTick()
}

function harness(t, get) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const scope = vue.effectScope()
  t.after(() => {
    scope.stop()
    disposePinia(pinia)
  })
  const useAccountStore = defineStore('account', () => {
    const currentAccountId = vue.ref('a')
    const accounts = vue.ref([{ id: 'a', running: false }])
    return {
      currentAccountId,
      accounts,
      currentAccount: vue.computed(() => accounts.value.find(account => account.id === currentAccountId.value)),
      loading: vue.ref(false),
    }
  })
  const account = useAccountStore(pinia)
  const requests = []
  const callbacks = new Map()
  const socket = {
    connected: false,
    on: (event, callback) => callbacks.set(event, callback),
    emit: () => {},
    connect: () => {},
  }
  const api = {
    get: (url, options) => {
      const id = options.headers['x-account-id']
      requests.push({ url, id })
      return get ? get(url, id) : Promise.resolve({ data: { ok: true, data: { accountId: id, connection: { connected: false } } } })
    },
  }
  const mounted = []
  const imports = {
    'vue': { ...vue, onMounted: callback => mounted.push(callback) },
    '@/api': { __esModule: true, default: api, getApiErrorMessage: value => value?.error || value?.message || '请求失败' },
    '@/stores/account': { useAccountStore },
    '@/stores/toast': { useToastStore: () => ({}) },
    '@vueuse/core': { useStorage: () => vue.ref('local-review-only'), useIntervalFn: () => {} },
    'socket.io-client': { io: () => socket },
  }
  for (const name of ['status', 'illustrated', 'pet', 'bag'])
    imports[`@/stores/${name}`] = loadSource(`stores/${name}.ts`, imports)
  const status = imports['@/stores/status'].useStatusStore(pinia)
  status.realtimeConnected = true
  status.status = { accountId: 'a', connection: { connected: false } }
  return {
    account,
    status,
    requests,
    emit: (event, body) => callbacks.get(event)?.(body),
    mount: (name) => {
      const component = loadSource(`components/${name}.vue`, imports).default
      scope.run(() => component.setup({}, { expose: () => {} }))
      for (const callback of mounted.splice(0))
        scope.run(callback)
    },
  }
}

for (const [panel, endpoint] of [
  ['IllustratedPanel', '/api/illustrated'],
  ['PetPanel', '/api/pets'],
  ['BagPanel', '/api/bag'],
  ['TaskPanel', '/api/daily-gifts'],
]) {
  test(`${panel} loads on login and reconnect even while the account list still says stopped`, async (t) => {
    const { account, status, requests, mount } = harness(t)
    mount(panel)
    await settle()
    const dataRequests = () => requests.filter(request => request.url === endpoint)
    assert.deepEqual(dataRequests(), [])

    status.status = { accountId: 'a', connection: { connected: true } }
    await settle()
    assert.deepEqual(dataRequests(), [{ url: endpoint, id: 'a' }])
    assert.equal(account.currentAccount.running, false)

    status.status = { accountId: 'a', connection: { connected: false } }
    await settle()
    status.status = { accountId: 'a', connection: { connected: true } }
    await settle()
    assert.equal(dataRequests().length, 2)

    // The next account's list entry and status may arrive in either order.
    account.currentAccountId = 'b'
    await settle()
    status.status = { accountId: 'a', connection: { connected: true } }
    await settle()
    assert.equal(dataRequests().length, 2)
    status.status = { accountId: 'b', connection: { connected: true } }
    await settle()
    assert.deepEqual(dataRequests().at(-1), { url: endpoint, id: 'b' })
    assert.equal(dataRequests().length, 3)
  })
}

test('current account readiness rejects other accounts and recovers from a stale running flag', async (t) => {
  const { account, status, emit } = harness(t)
  status.connectRealtime('a')
  await settle()
  assert.equal(status.currentAccountConnected, false)
  emit('status:update', { accountId: 'a', status: { accountId: 'a', connection: { connected: true } } })
  assert.equal(status.currentAccountConnected, true)
  account.currentAccountId = 'b'
  assert.equal(status.status, null)
  emit('status:update', { accountId: 'a', status: { accountId: 'a', connection: { connected: true } } })
  assert.equal(status.status, null)
  assert.equal(status.currentAccountConnected, false)
  status.connectRealtime('b')
  await settle()
  emit('status:update', { accountId: 'b', status: { accountId: 'b', connection: { connected: true } } })
  assert.equal(status.currentAccountConnected, true)
})

test('a delayed pre-login status reply cannot overwrite a newer connected push', async (t) => {
  let finishStatus
  const { status, emit } = harness(t, () => new Promise(resolve => finishStatus = resolve))
  status.connectRealtime('a')
  emit('status:update', { accountId: 'a', status: { accountId: 'a', connection: { connected: true } } })
  finishStatus({ data: { ok: true, data: { accountId: 'a', connection: { connected: false } } } })
  await settle()
  assert.equal(status.currentAccountConnected, true)
  assert.equal(status.loading, false)
})
