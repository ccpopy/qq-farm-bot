<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ adult: boolean }>()
const assetRoot = '/activity-assets/pet-diary/'
const revision = '20260911-pma-eyes'
const stage = computed(() => props.adult ? 'adult' : 'puppy')
</script>

<template>
  <div class="pet-dog-scene">
    <img class="pet-room-still" :src="`${assetRoot}scene-home-${stage}.png?v=${revision}`" :alt="adult ? '成年比熊坐在家中的爪印地毯上' : '幼年比熊坐在家中的爪印地毯上'">
  </div>
</template>

<style scoped>
.pet-dog-scene,
.pet-room-still {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
.pet-room-still {
  object-fit: contain;
}
</style>
