<template>
  <div :class="{ 'is-hidden': hidden }">
    <nav ref="bar" class="glass-bar" :class="{ 'is-pressed': pressed, 'has-refraction': displacementMap }"
      :style="barStyle" aria-label="移动端主导航"
      @pointerdown="start" @pointermove="move" @pointerup="finish" @pointercancel="cancel"
      @lostpointercapture="cancel" @click.capture="guardClick">
      <svg class="glass-filter" aria-hidden="true" width="0" height="0">
        <defs>
          <filter :id="filterId" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
            <feImage :href="displacementMap" width="100%" height="100%" result="lens" preserveAspectRatio="none" />
            <feDisplacementMap in="SourceGraphic" in2="lens" scale="18" xChannelSelector="R" yChannelSelector="G" />
          </filter>
          <filter :id="`${filterId}-selection`" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
            <feImage :href="selectionMap" width="100%" height="100%" result="lens" preserveAspectRatio="none" />
            <feDisplacementMap in="SourceGraphic" in2="lens" scale="12" xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </defs>
      </svg>
      <div class="glass-lens" :class="{ 'is-absent': activeIndex < 0 && !pressed }" aria-hidden="true" />
      <RouterLink v-for="(item, index) in items" :key="item.label" :to="item.to"
        class="glass-tab" :class="{ 'is-active': index === activeIndex }"
        :aria-current="index === activeIndex ? 'page' : undefined" draggable="false">
        <el-icon><component :is="item.icon" /></el-icon>
        <span>{{ item.label }}</span>
      </RouterLink>
    </nav>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId, watch, type Component } from 'vue';
import { RouterLink, useRouter, type RouteLocationRaw } from 'vue-router';

const props = defineProps<{
  items: { label: string; icon: Component; to: RouteLocationRaw }[];
  activeIndex: number;
  hidden: boolean;
}>();
const router = useRouter();
const bar = ref<HTMLElement>();
const pressed = ref(false);
const position = ref(0);
const stretch = ref(0);
const displacementMap = ref('');
const selectionMap = ref('');
const filterId = `liquid-nav-${useId().replace(/:/g, '')}`;
let pointer: number | null = null;
let startX = 0;
let lastX = 0;
let dragged = false;
let suppressClickUntil = 0;
let observer: ResizeObserver | undefined;
const barStyle = computed(() => ({
  '--count': props.items.length,
  '--position': pressed.value ? position.value : Math.max(0, props.activeIndex),
  '--stretch': stretch.value,
  '--refraction': `url("#${filterId}")`,
  '--selection-refraction': `url("#${filterId}-selection")`,
}));

function indexAt(x: number) {
  const rect = bar.value!.getBoundingClientRect();
  const width = (rect.width - 8) / props.items.length;
  return Math.max(0, Math.min(props.items.length - 1, (x - rect.left - 4) / width - 0.5));
}
function start(event: PointerEvent) {
  if (!event.isPrimary || event.button !== 0 || props.hidden) return;
  pointer = event.pointerId;
  startX = lastX = event.clientX;
  dragged = false;
  position.value = indexAt(event.clientX);
  pressed.value = true;
}
function move(event: PointerEvent) {
  if (pointer !== event.pointerId) return;
  if (Math.abs(event.clientX - startX) > 6) {
    dragged = true;
    bar.value?.setPointerCapture(event.pointerId);
  }
  position.value = indexAt(event.clientX);
  stretch.value = Math.min(0.16, Math.abs(event.clientX - lastX) / 160);
  lastX = event.clientX;
}
function finish(event: PointerEvent) {
  if (pointer !== event.pointerId) return;
  if (dragged) {
    suppressClickUntil = performance.now() + 400;
    const item = props.items[Math.round(position.value)];
    if (item) void router.push(item.to);
  }
  cancel();
}
function cancel() {
  const captured = pointer;
  pointer = null;
  pressed.value = false;
  stretch.value = 0;
  if (captured !== null && bar.value?.hasPointerCapture(captured)) bar.value.releasePointerCapture(captured);
}
function guardClick(event: MouseEvent) {
  if (event.detail && performance.now() < suppressClickUntil) {
    event.preventDefault();
    event.stopPropagation();
  }
}
watch(() => [props.hidden, props.items.length], cancel);

// Chromium supports SVG backdrop filters; WebKit uses the CSS glass fallback.
function updateLens() {
  if (!bar.value || !/Chrome|Chromium|Edg\//.test(navigator.userAgent)) return;
  const width = Math.round(bar.value.clientWidth);
  const height = Math.round(bar.value.clientHeight);
  if (!width || !height) return;
  displacementMap.value = createLensMap(width, height);
  selectionMap.value = createLensMap(Math.round((width - 8) / props.items.length), height - 8);
}
function createLensMap(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return '';
  const pixels = context.createImageData(width, height);
  const radius = height / 2;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cx = Math.max(radius, Math.min(width - radius, x));
      const dx = x - cx;
      const dy = y - radius;
      const distance = Math.hypot(dx, dy);
      const edge = Math.max(0, 1 - Math.abs(radius - distance) / 12);
      const strength = edge * edge * 110 / Math.max(1, distance);
      const offset = (y * width + x) * 4;
      pixels.data[offset] = 128 + dx * strength;
      pixels.data[offset + 1] = 128 + dy * strength;
      pixels.data[offset + 2] = 128;
      pixels.data[offset + 3] = 255;
    }
  }
  context.putImageData(pixels, 0, 0);
  return canvas.toDataURL();
}
onMounted(() => {
  observer = new ResizeObserver(updateLens);
  if (bar.value) observer.observe(bar.value);
  window.addEventListener('pointerup', cancel);
  window.addEventListener('blur', cancel);
});
onBeforeUnmount(() => {
  cancel();
  observer?.disconnect();
  window.removeEventListener('pointerup', cancel);
  window.removeEventListener('blur', cancel);
});
</script>

<style scoped>
.glass-bar {
  position: relative;
  display: grid;
  grid-template-columns: repeat(var(--count), minmax(0, 1fr));
  width: 100%;
  height: 56px;
  padding: 4px;
  box-sizing: border-box;
  border-radius: 999px;
  background: color-mix(in srgb, var(--cpu-surface, #fff) 62%, transparent);
  -webkit-backdrop-filter: blur(12px) saturate(1.65);
  backdrop-filter: blur(12px) saturate(1.65);
  box-shadow: 0 5px 20px #00000014, inset 0 1px 1px #ffffffb3, inset 0 -1px 1px #ffffff66;
  touch-action: pan-y;
  user-select: none;
  -webkit-user-select: none;
}
.glass-bar.has-refraction { backdrop-filter: var(--refraction) blur(4px) saturate(1.65); }
.glass-filter { position: absolute; pointer-events: none; }
.glass-lens {
  position: absolute;
  top: 4px;
  left: 4px;
  width: calc((100% - 8px) / var(--count));
  height: 48px;
  border-radius: 999px;
  pointer-events: none;
  background: color-mix(in srgb, var(--cpu-primary) 10%, transparent);
  box-shadow: inset 0 1px 1px #ffffffb3, inset 0 -1px 2px #0000000a;
  transform: translateX(calc(var(--position) * 100%));
  transition: transform 480ms cubic-bezier(.22, 1.35, .36, 1), background 200ms, box-shadow 200ms, opacity 150ms;
}
.is-pressed .glass-lens {
  transform: translateX(calc(var(--position) * 100%)) scale(calc(1.06 + var(--stretch)), calc(1.06 - var(--stretch) * .5));
  background: #ffffff26;
  box-shadow: inset 0 1px 2px #ffffffed, inset 1px 0 2px #ffffff80, inset 0 -2px 3px #00000017, 0 3px 9px #0000000d;
  transition: transform 70ms linear, background 150ms, box-shadow 150ms;
}
.has-refraction.is-pressed .glass-lens { backdrop-filter: var(--selection-refraction) saturate(1.2); }
.is-absent { opacity: 0; }
.glass-tab {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  min-width: 0;
  border-radius: 999px;
  color: var(--cpu-text-secondary);
  text-decoration: none;
  -webkit-tap-highlight-color: transparent;
  transition: color 180ms, transform 250ms;
}
.glass-tab.is-active { color: var(--cpu-primary); }
.glass-tab .el-icon { font-size: 21px; }
.glass-tab span { font-size: 11px; font-weight: 550; white-space: nowrap; }
.glass-tab:focus-visible { outline: 2px solid var(--cpu-primary); outline-offset: -2px; }
.is-pressed .glass-tab.is-active { transform: scale(1.08); }
:global(html[data-theme="dark"]) .glass-bar { background: #202925b8; box-shadow: 0 5px 20px #0004, inset 0 1px 1px #ffffff59, inset 0 -1px 1px #ffffff1f; }
@supports not (backdrop-filter: blur(1px)) {
  .glass-bar { background: var(--cpu-surface, #fff); }
}
@media (prefers-reduced-motion: reduce) {
  .glass-lens, .glass-tab, .is-pressed .glass-lens { transition: none; }
  .is-pressed .glass-lens { transform: translateX(calc(var(--position) * 100%)); }
  .is-pressed .glass-tab.is-active { transform: none; }
}
</style>
