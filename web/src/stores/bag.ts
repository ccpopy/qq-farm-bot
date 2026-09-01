import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import api from '@/api'
import { useAccountStore } from '@/stores/account'
import { bagMutationFailure, normalizeBagMutationResponse } from '@/utils/bag-mutation.js'

export const useBagStore = defineStore('bag', () => {
  const allItems = ref<any[]>([])
  const originalItems = ref<any[]>([])
  const systemItems = ref<any[]>([])
  const loading = ref(false)
  let pendingFetch: Promise<boolean> | null = null
  let pendingAccountId = ''
  let loadedAccountId = ''

  function clearBag() {
    allItems.value = []
    originalItems.value = []
    systemItems.value = []
    loadedAccountId = ''
  }

  const items = computed(() => allItems.value)

  const dashboardItems = computed(() => {
    const targetIds = new Set([1011, 1012, 3001, 3002])
    return systemItems.value.filter((it: any) => targetIds.has(Number(it.id || 0)))
  })

  async function fetchBag(accountId: string) {
    if (!accountId)
      return false
    const requestedId = String(accountId)
    if (pendingFetch && pendingAccountId === requestedId)
      return pendingFetch

    if (loadedAccountId && loadedAccountId !== requestedId)
      clearBag()

    loading.value = true
    const request = (async () => {
      try {
        const res = await api.get('/api/bag', {
          headers: { 'x-account-id': requestedId },
        })
        const acc = useAccountStore()
        const curId = String((acc.currentAccountId as { value?: string })?.value ?? acc.currentAccountId ?? '')
        if (curId !== requestedId)
          return false
        if (res.data.ok && res.data.data) {
          allItems.value = Array.isArray(res.data.data.items) ? res.data.data.items : []
          originalItems.value = Array.isArray(res.data.data.originalItems) ? res.data.data.originalItems : []
          systemItems.value = Array.isArray(res.data.data.systemItems) ? res.data.data.systemItems : []
          loadedAccountId = requestedId
          return true
        }
        return false
      }
      catch (e) {
        console.error(e)
        return false
      }
    })()
    pendingFetch = request
    pendingAccountId = requestedId
    try {
      return await request
    }
    finally {
      if (pendingFetch === request) {
        pendingFetch = null
        pendingAccountId = ''
        loading.value = false
      }
    }
  }

  async function useItem(accountId: string, itemId: number, count = 1, uid = 0) {
    try {
      const res = await api.post('/api/bag/use', { itemId, count, uid }, {
        headers: { 'x-account-id': accountId },
        skipErrorToast: true,
      } as any)
      return normalizeBagMutationResponse(res.data, '使用失败')
    }
    catch (cause: unknown) {
      return bagMutationFailure(cause, '使用失败')
    }
  }

  async function sellItems(accountId: string, items: Array<{ id: number, count: number, uid?: number }>) {
    try {
      const res = await api.post('/api/bag/sell', { items }, {
        headers: { 'x-account-id': accountId },
        skipErrorToast: true,
      } as any)
      return normalizeBagMutationResponse(res.data, '出售失败')
    }
    catch (cause: unknown) {
      return bagMutationFailure(cause, '出售失败')
    }
  }

  async function setItemsLocked(accountId: string, itemUids: number[], locked: boolean) {
    try {
      const res = await api.post('/api/bag/lock', { itemUids, locked }, {
        headers: { 'x-account-id': accountId },
        skipErrorToast: true,
      } as any)
      return normalizeBagMutationResponse(res.data, `${locked ? '锁定' : '解锁'}失败`)
    }
    catch (cause: unknown) {
      return bagMutationFailure(cause, `${locked ? '锁定' : '解锁'}失败`)
    }
  }

  return {
    items,
    allItems,
    originalItems,
    systemItems,
    dashboardItems,
    loading,
    fetchBag,
    clearBag,
    useItem,
    sellItems,
    setItemsLocked,
  }
})
