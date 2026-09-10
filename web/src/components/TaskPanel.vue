<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, watch } from 'vue'
import DailyOverview from '@/components/DailyOverview.vue'
import { useAccountStore } from '@/stores/account'
import { useStatusStore } from '@/stores/status'

const statusStore = useStatusStore()
const accountStore = useAccountStore()
const { status, dailyGifts, dailyGiftsLoading, dailyGiftsError, loading: statusLoading, realtimeConnected } = storeToRefs(statusStore)
const { currentAccountId, currentAccount } = storeToRefs(accountStore)

const growth = computed(() => dailyGifts.value?.growth || null)
const growthCurrentTask = computed(() => growth.value?.currentTask || growth.value?.tasks?.[0] || null)
const taskEmptyText = computed(() => {
  if (!currentAccountId.value)
    return '请登录账号后查看'
  if (accountStore.loading || statusLoading.value)
    return '正在加载账号状态…'
  if (!status.value?.connection?.connected)
    return '账号未登录，请先运行账号或检查网络连接'
  if (dailyGiftsError.value)
    return '任务加载失败，请重试'
  return dailyGiftsLoading.value || !dailyGifts.value ? '正在加载任务…' : '暂无任务详情'
})

async function refresh() {
  const id = currentAccountId.value
  if (!id || !currentAccount.value?.running)
    return
  if (!realtimeConnected.value)
    await statusStore.fetchStatus(id)
  if (id === currentAccountId.value && currentAccount.value?.running && status.value?.connection?.connected)
    await statusStore.fetchDailyGifts(id)
}

// 账号列表和连接快照可能晚于面板挂载到达，就绪后自动补加载。
watch([currentAccountId, () => currentAccount.value?.running, () => !!status.value?.connection?.connected], refresh, { immediate: true })

function formatTaskProgress(task: any) {
  if (!task)
    return '未开始'
  const rawCurrent = task.progress ?? task.current
  const rawTarget = task.totalProgress ?? task.target

  const current = Number.isFinite(rawCurrent)
    ? rawCurrent
    : (rawCurrent ? Number(rawCurrent) || 0 : 0)

  const target = Number.isFinite(rawTarget)
    ? rawTarget
    : (rawTarget ? Number(rawTarget) || 0 : 0)

  if (!current && !target)
    return '未开始'

  if (target && current >= target)
    return '已完成'

  return `进度：${current}/${target}`
}
</script>

<template>
  <div class="space-y-6">
    <!-- Daily Overview (Daily Gifts & Tasks) -->
    <DailyOverview :daily-gifts="dailyGifts" :empty-text="taskEmptyText" />
    <div v-if="dailyGiftsError" class="flex items-center justify-between gap-3 farm-card rounded-xl p-4 text-sm" role="alert">
      <span>{{ dailyGiftsError }}</span>
      <button class="shrink-0 text-green-600" :disabled="dailyGiftsLoading || !status?.connection?.connected" @click="refresh">
        重新加载
      </button>
    </div>

    <!-- Growth Task -->
    <div class="flex flex-col farm-card rounded-xl p-4">
      <div class="mb-3 flex items-center justify-between">
        <h3 class="flex items-center gap-2 font-medium" style="color: var(--theme-primary, #22c55e)">
          <span class="i-carbon-growth" />
          <span>成长任务</span>
        </h3>
        <span
          v-if="growth"
          class="rounded-lg bg-blue-50 px-2.5 py-0.5 text-xs text-blue-600 font-bold dark:bg-blue-900/20 dark:text-blue-400"
        >
          {{ growthCurrentTask ? `${growthCurrentTask.progress}/${growthCurrentTask.totalProgress}` : '暂无任务' }}
        </span>
      </div>

      <div
        v-if="!currentAccountId"
        class="flex flex-col items-center justify-center gap-3 rounded-xl py-8 text-center"
        style="background: color-mix(in srgb, var(--theme-bg, #fff) 90%, var(--theme-primary, #3b82f6))"
      >
        <div class="i-carbon-user-avatar text-3xl" style="opacity: 0.5" />
        <div>
          <div class="text-sm font-medium" style="color: var(--theme-text, #374151)">
            未登录账号
          </div>
          <div class="mt-1 text-xs text-gray-400">
            请先添加农场账号
          </div>
        </div>
      </div>
      <div
        v-else-if="!status?.connection?.connected"
        class="flex flex-col items-center justify-center gap-3 rounded-xl py-8 text-center"
        style="background: color-mix(in srgb, var(--theme-bg, #fff) 90%, var(--theme-primary, #3b82f6))"
      >
        <div class="i-carbon-network-4 text-3xl" style="opacity: 0.5" />
        <div>
          <div class="text-sm font-medium" style="color: var(--theme-text, #374151)">
            账号未登录
          </div>
          <div class="mt-1 text-xs text-gray-400">
            请先运行账号或检查网络连接
          </div>
        </div>
      </div>
      <div
        v-else-if="growth && growth.tasks && growth.tasks.length"
        class="space-y-2"
      >
        <div
          v-for="(task, idx) in growth.tasks"
          :key="task.id || idx"
          class="flex items-center justify-between rounded-lg px-2 py-1.5 text-sm transition hover:bg-black/5 dark:hover:bg-white/5"
        >
          <span style="color: var(--theme-text, #6b7280); opacity: 0.85">{{ task.desc || task.name }}</span>
          <span class="text-xs text-gray-500">{{ formatTaskProgress(task) }}</span>
        </div>
      </div>
      <div v-else class="text-center text-sm text-gray-400">
        {{ taskEmptyText }}
      </div>
    </div>
  </div>
</template>
