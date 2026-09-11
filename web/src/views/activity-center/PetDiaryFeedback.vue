<script setup lang="ts">
import { NMessageProvider } from 'naive-ui/es/message'
import { nextTick, onMounted, onUnmounted, shallowRef } from 'vue'
import PetDiaryMessages from './PetDiaryMessages.vue'

const target = shallowRef<HTMLElement>(document.body)
function syncTarget() {
  // Native modal dialogs render above body-level notifications.
  const dialogs = document.querySelectorAll<HTMLDialogElement>('.pet-diary dialog[open]')
  target.value = dialogs[dialogs.length - 1] || document.body
}
async function prepare() {
  syncTarget()
  await nextTick()
}
onMounted(() => document.addEventListener('close', syncTarget, true))
onUnmounted(() => document.removeEventListener('close', syncTarget, true))
</script>

<template>
  <NMessageProvider :to="target" placement="top-right" :max="4" keep-alive-on-hover>
    <PetDiaryMessages :prepare="prepare" />
  </NMessageProvider>
</template>
