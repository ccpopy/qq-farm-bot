<script setup lang="ts">
import { NMessageProvider } from 'naive-ui/es/message'
import { nextTick, onMounted, onUnmounted } from 'vue'
import PetDiaryMessages from './PetDiaryMessages.vue'

// Keep Vue's Teleport target stable while native dialogs open and close.
// Moving the host preserves its anchors and avoids mixing them with dialog children.
const target = document.createElement('div')
target.className = 'pet-message-host'
target.style.display = 'contents'
function syncTarget() {
  // Native modal dialogs render above body-level notifications.
  const dialogs = document.querySelectorAll<HTMLDialogElement>('.pet-diary dialog[open]')
  const container = dialogs[dialogs.length - 1] || document.body
  if (target.parentNode !== container)
    container.appendChild(target)
}
async function prepare() {
  syncTarget()
  await nextTick()
}
onMounted(() => {
  syncTarget()
  document.addEventListener('close', syncTarget, true)
})
onUnmounted(() => {
  document.removeEventListener('close', syncTarget, true)
  target.remove()
})
</script>

<template>
  <NMessageProvider :to="target" placement="top-right" :max="4" keep-alive-on-hover>
    <PetDiaryMessages :prepare="prepare" />
  </NMessageProvider>
</template>
