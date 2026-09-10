import type { Socket } from 'socket.io-client'
import { useStorage } from '@vueuse/core'
import { defineStore } from 'pinia'
import { io } from 'socket.io-client'
import { computed, ref, watch } from 'vue'
import api, { getApiErrorMessage } from '@/api'
import { useAccountStore } from '@/stores/account'

// Define interfaces for better type checking
interface DailyGift {
  key: string
  label: string
  enabled?: boolean
  doneToday: boolean
  lastAt?: number
  completedCount?: number
  totalCount?: number
  tasks?: any[]
  currentTask?: any | null
  mode?: 'check_only' | 'auto_claim'
  checkedToday?: boolean
  checkStatus?: 'unchecked' | 'entry_available' | 'entry_unavailable' | 'already_claimed' | 'check_failed'
  canShare?: boolean | null
}

interface DailyGiftsResponse {
  date: string
  growth: DailyGift
  gifts: DailyGift[]
}

export const useStatusStore = defineStore('status', () => {
  const accountStore = useAccountStore()
  const status = ref<any>(null)
  const logs = ref<any[]>([])
  const dailyGifts = ref<DailyGiftsResponse | null>(null)
  const dailyGiftsLoading = ref(false)
  const dailyGiftsError = ref('')
  const diamondBalance = ref(0)
  const loading = ref(false)
  const error = ref('')
  const realtimeConnected = ref(false)
  const realtimeLogsEnabled = ref(true)
  const currentRealtimeAccountId = ref('')
  const tokenRef = useStorage('admin_token', '')

  // 账号列表的 running 是请求时的快照；面板就绪以当前账号的实时连接为准。
  const currentAccountConnected = computed(() => {
    const accountId = String(accountStore.currentAccountId || '')
    return !!accountId
      && String(status.value?.accountId || '') === accountId
      && !!status.value?.connection?.connected
  })

  let socket: Socket | null = null
  let statusRequestSequence = 0
  let diamondRequestSequence = 0
  let dailyGiftsSequence = 0
  let pendingDailyGifts: Promise<void> | null = null

  watch(() => accountStore.currentAccountId, () => {
    statusRequestSequence++
    status.value = null
    loading.value = false
    error.value = ''
    dailyGiftsSequence++
    pendingDailyGifts = null
    dailyGifts.value = null
    dailyGiftsLoading.value = false
    dailyGiftsError.value = ''
  }, { flush: 'sync' })

  function normalizeStatusPayload(input: any) {
    return (input && typeof input === 'object') ? { ...input } : {}
  }

  function normalizeLogEntry(input: any) {
    const entry = (input && typeof input === 'object') ? { ...input } : {}
    const ts = Number(entry.ts) || Date.parse(String(entry.time || '')) || Date.now()
    return {
      ...entry,
      ts,
      time: entry.time || new Date(ts).toISOString().replace('T', ' ').slice(0, 19),
    }
  }

  function pushRealtimeLog(entry: any) {
    const next = normalizeLogEntry(entry)
    logs.value.push(next)
    if (logs.value.length > 300)
      logs.value = logs.value.slice(-300)
  }

  function handleRealtimeStatus(payload: any) {
    const body = (payload && typeof payload === 'object') ? payload : {}
    const accountId = String(body.accountId || '')
    if (!accountId || accountId !== accountStore.currentAccountId || accountId !== currentRealtimeAccountId.value)
      return
    if (body.status && typeof body.status === 'object') {
      statusRequestSequence++
      loading.value = false
      status.value = normalizeStatusPayload(body.status)
      error.value = ''
    }
  }

  function handleRealtimeLog(payload: any) {
    if (!realtimeLogsEnabled.value)
      return
    pushRealtimeLog(payload)
  }

  function handleRealtimeLogsSnapshot(payload: any) {
    const body = (payload && typeof payload === 'object') ? payload : {}
    const list = Array.isArray(body.logs) ? body.logs : []
    logs.value = list.map((item: any) => normalizeLogEntry(item))
  }

  function ensureRealtimeSocket() {
    if (socket)
      return socket

    socket = io('/', {
      path: '/socket.io',
      autoConnect: false,
      transports: ['websocket'],
      auth: {
        token: tokenRef.value,
      },
    })

    socket.on('connect', () => {
      realtimeConnected.value = true
      if (currentRealtimeAccountId.value) {
        socket?.emit('subscribe', { accountId: currentRealtimeAccountId.value })
      }
      else {
        socket?.emit('subscribe', { accountId: 'all' })
      }
    })

    socket.on('disconnect', () => {
      realtimeConnected.value = false
    })

    socket.on('connect_error', (err) => {
      realtimeConnected.value = false
      console.error('[realtime] 连接失败:', err.message)
    })

    socket.on('status:update', handleRealtimeStatus)
    socket.on('log:new', handleRealtimeLog)
    socket.on('logs:snapshot', handleRealtimeLogsSnapshot)
    return socket
  }

  function connectRealtime(accountId: string) {
    const nextAccountId = String(accountId || '').trim()
    const accountChanged = nextAccountId !== currentRealtimeAccountId.value
    currentRealtimeAccountId.value = nextAccountId
    if (accountChanged) {
      statusRequestSequence++
      status.value = null
      loading.value = false
      error.value = ''
    }
    if (!tokenRef.value)
      return

    if (nextAccountId && (accountChanged || (!status.value && !loading.value)))
      void fetchStatus(nextAccountId)

    const client = ensureRealtimeSocket()
    client.auth = {
      token: tokenRef.value,
      accountId: currentRealtimeAccountId.value || 'all',
    }

    if (client.connected) {
      client.emit('subscribe', { accountId: currentRealtimeAccountId.value || 'all' })
      return
    }
    client.connect()
  }

  function disconnectRealtime() {
    if (!socket)
      return
    socket.off('connect')
    socket.off('disconnect')
    socket.off('connect_error')
    socket.off('status:update', handleRealtimeStatus)
    socket.off('log:new', handleRealtimeLog)
    socket.off('logs:snapshot', handleRealtimeLogsSnapshot)
    socket.disconnect()
    socket = null
    realtimeConnected.value = false
  }

  async function fetchStatus(accountId: string) {
    if (!accountId || accountId !== accountStore.currentAccountId)
      return
    const sequence = ++statusRequestSequence
    loading.value = true
    try {
      const { data } = await api.get('/api/status', {
        headers: { 'x-account-id': accountId },
      })
      if (sequence !== statusRequestSequence)
        return
      if (data.ok) {
        status.value = normalizeStatusPayload(data.data)
        error.value = ''
      }
      else {
        error.value = data.error
      }
    }
    catch (e: any) {
      if (sequence === statusRequestSequence)
        error.value = e.message
    }
    finally {
      if (sequence === statusRequestSequence)
        loading.value = false
    }
  }

  async function fetchLogs(accountId: string, options: any = {}) {
    if (!accountId && options.accountId !== 'all')
      return
    const params: any = { limit: 100, ...options }
    const headers: any = {}
    if (accountId && accountId !== 'all') {
      headers['x-account-id'] = accountId
    }
    else {
      params.accountId = 'all'
    }

    try {
      const { data } = await api.get('/api/logs', { headers, params })
      if (data.ok) {
        logs.value = data.data
        error.value = ''
      }
    }
    catch (e: any) {
      console.error(e)
    }
  }

  async function fetchDiamond(accountId: string) {
    const id = String(accountId || '').trim()
    if (!id)
      return
    const sequence = ++diamondRequestSequence
    diamondBalance.value = 0

    try {
      const { data } = await api.get('/api/diamond', {
        headers: { 'x-account-id': id },
        skipErrorToast: true,
      } as any)
      if (data.ok && sequence === diamondRequestSequence)
        diamondBalance.value = Math.max(0, Number(data.data?.diamond) || 0)
    }
    catch {
      // Supplementary balance data should not disrupt the dashboard.
    }
  }

  async function fetchDailyGifts(accountId: string) {
    if (!accountId || accountId !== accountStore.currentAccountId)
      return
    if (pendingDailyGifts)
      return pendingDailyGifts

    const sequence = ++dailyGiftsSequence
    dailyGiftsLoading.value = true
    dailyGiftsError.value = ''
    const request = (async () => {
      try {
        const { data } = await api.get('/api/daily-gifts', {
          headers: { 'x-account-id': accountId },
          skipErrorToast: true,
        } as any)
        if (sequence !== dailyGiftsSequence || accountId !== accountStore.currentAccountId)
          return
        if (data.ok)
          dailyGifts.value = data.data
        else
          dailyGiftsError.value = getApiErrorMessage(data, '获取任务失败')
      }
      catch (e) {
        if (sequence === dailyGiftsSequence)
          dailyGiftsError.value = getApiErrorMessage(e, '获取任务失败')
      }
    })()
    pendingDailyGifts = request
    try {
      await request
    }
    finally {
      if (pendingDailyGifts === request) {
        pendingDailyGifts = null
        dailyGiftsLoading.value = false
      }
    }
  }

  function setRealtimeLogsEnabled(enabled: boolean) {
    realtimeLogsEnabled.value = !!enabled
  }

  return {
    status,
    currentAccountConnected,
    logs,
    dailyGifts,
    dailyGiftsLoading,
    dailyGiftsError,
    diamondBalance,
    loading,
    error,
    realtimeConnected,
    realtimeLogsEnabled,
    fetchStatus,
    fetchDiamond,
    fetchLogs,
    fetchDailyGifts,
    setRealtimeLogsEnabled,
    connectRealtime,
    disconnectRealtime,
  }
})
