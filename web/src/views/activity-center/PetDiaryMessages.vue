<script setup lang="ts">
import { useMessage } from 'naive-ui/es/message'
import { onUnmounted, watch } from 'vue'
import { usePetDiaryStore } from '@/stores/pet-diary'

const props = defineProps<{ prepare: () => Promise<void> }>()
const diary = usePetDiaryStore()
const message = useMessage()
let disposed = false
async function show(type: 'success' | 'error' | 'warning', text: string) {
  if (!text)
    return
  const owner = diary.accountId
  await props.prepare()
  if (disposed || owner !== diary.accountId)
    return
  message[type](text, { duration: type === 'success' ? 3000 : 5000, closable: true, keepAliveOnHover: true })
}
watch(() => diary.notice, text => void show('success', text))
watch(() => diary.error, text => void show('error', text))
watch(() => diary.activity?.warnings.join('\n') || '', text => void show('warning', text))
onUnmounted(() => {
  disposed = true
  message.destroyAll()
})
</script>

<template>
  <span hidden aria-hidden="true" />
</template>
