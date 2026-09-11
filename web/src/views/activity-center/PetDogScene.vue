<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'

const props = defineProps<{ adult: boolean }>()
const assetRoot = '/activity-assets/pet-diary/'
const revision = '20260911-pma-eyes'
const animating = ref(false)
const roomReady = ref(false)
const animationReady = ref(false)
let timer: ReturnType<typeof setTimeout> | undefined
const stage = computed(() => props.adult ? 'adult' : 'puppy')
// Both exports use the same room coordinates as their static Spine pose.
const motion = computed(() => props.adult
  ? { x: 223, y: 625, width: 401, height: 434, duration: 2833 }
  : { x: 241, y: 637, width: 407, height: 422, duration: 3000 })
const motionStyle = computed(() => ({
  left: `${motion.value.x / 9}%`,
  top: `${motion.value.y / 14}%`,
  width: `${motion.value.width / 9}%`,
  height: `${motion.value.height / 14}%`,
}))

function stop() {
  clearTimeout(timer)
  timer = undefined
  animating.value = false
  animationReady.value = false
}
function play() {
  if (animating.value || window.matchMedia('(prefers-reduced-motion: reduce)').matches)
    return
  animating.value = true
  timer = setTimeout(stop, 15000)
}
function animationLoaded() {
  if (!animating.value)
    return
  animationReady.value = true
  clearTimeout(timer)
  timer = setTimeout(stop, motion.value.duration)
}
watch(() => props.adult, stop)
onUnmounted(stop)
</script>

<template>
  <div class="pet-dog-scene">
    <img class="pet-room-still" :src="`${assetRoot}scene-home-${stage}.png?v=${revision}`" :alt="adult ? '成年比熊坐在家中的爪印地毯上' : '幼年比熊坐在家中的爪印地毯上'">
    <div v-if="animating" class="pet-dog-motion" :class="{ ready: animationReady }" aria-hidden="true">
      <img class="pet-room-base" :src="`${assetRoot}img_s3BattlePass_bg.png`" alt="" @load="roomReady = true" @error="stop">
      <img v-if="roomReady" class="pet-dog-animation" :style="motionStyle" :src="`${assetRoot}dog-${stage}-tap.webp?v=${revision}`" alt="" @load="animationLoaded" @error="stop">
    </div>
    <button type="button" class="pet-dog-touch" :style="motionStyle" :aria-label="adult ? '摸摸成年比熊' : '摸摸幼年比熊'" :aria-busy="animating" title="摸摸比熊" @click="play" />
  </div>
</template>

<style scoped>
.pet-dog-scene,
.pet-room-still,
.pet-dog-motion {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
.pet-room-still {
  object-fit: contain;
}
.pet-dog-motion {
  overflow: hidden;
  visibility: hidden;
}
.pet-dog-motion.ready {
  visibility: visible;
}
.pet-room-base {
  display: block;
  width: 100%;
  height: auto;
}
.pet-dog-animation,
.pet-dog-touch {
  position: absolute;
}
.pet-dog-touch {
  padding: 0;
  border: 0;
  border-radius: 45%;
  background: none;
  cursor: pointer;
  pointer-events: auto;
  -webkit-tap-highlight-color: transparent;
}
.pet-dog-touch:focus-visible {
  outline: 3px solid #749645;
  outline-offset: 3px;
}
</style>
