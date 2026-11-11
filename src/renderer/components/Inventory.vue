<template>
  <div>
    <p class="text-gray-400 text-xs mb-3">{{ text.note }}</p>
    <div v-for="group of groups" :key="group.key" class="mb-5">
      <component :is="group.collapsed ? 'details' : 'div'">
        <component :is="group.collapsed ? 'summary' : 'p'" class="text-gray-600 text-sm mb-2 cursor-default">
          <span :class="group.color">{{ group.label }}</span>
          <span class="text-gray-400 text-xs ml-2">{{ group.items.length }} · {{ group.total }} {{ text.pulls }}</span>
        </component>
        <div class="grid gap-2 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          <div v-for="item of group.items" :key="item.name"
               class="border rounded px-2 py-1.5 text-xs" :class="group.border"
               :title="item.dates.length ? item.dates.join('\n') : text.unknownDate">
            <div class="flex justify-between items-center gap-1">
              <span class="text-gray-700 truncate">{{ item.name }}</span>
              <span class="shrink-0 font-semibold" :class="group.color">{{ item.badge }}</span>
            </div>
            <div class="text-gray-400 mt-0.5">
              ×{{ item.count }} · {{ item.first || text.unknownDate }}
            </div>
          </div>
        </div>
      </component>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { isWeapon } from '../utils'

const props = defineProps({
  result: Map,
  i18n: Object
})

const text = computed(() => props.i18n.ui.inventory)

const formatDate = (time) => {
  const ts = new Date(time).getTime()
  return ts ? new Date(ts).toLocaleDateString() : ''
}

const groups = computed(() => {
  const items = new Map()
  for (const records of props.result.values()) {
    for (const [time, name, type, rank] of records) {
      const weapon = isWeapon(type)
      const key = `${rank}-${weapon ? 'w' : 'c'}-${name}`
      if (!items.has(key)) items.set(key, { name, rank, weapon, count: 0, dates: [] })
      const item = items.get(key)
      item.count++
      const date = formatDate(time)
      if (date) item.dates.push({ ts: new Date(time).getTime(), date })
    }
  }

  const build = (key, rank, weapon, label, color, border, collapsed = false) => {
    const list = [...items.values()]
      .filter(item => item.rank === rank && item.weapon === weapon)
      .map(item => {
        const dates = item.dates.sort((a, b) => a.ts - b.ts).map(d => d.date)
        return {
          name: item.name,
          count: item.count,
          first: dates[0] || '',
          dates,
          badge: weapon
            ? (rank === 3 ? '' : `R${Math.min(item.count, 5)}`)
            : `C${Math.min(item.count - 1, 6)}${item.count > 7 ? `+${item.count - 7}` : ''}`
        }
      })
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    return { key, label, color, border, collapsed, items: list, total: list.reduce((s, i) => s + i.count, 0) }
  }

  return [
    build('c5', 5, false, text.value.char5, 'text-yellow-500', 'border-yellow-200'),
    build('w5', 5, true, text.value.weapon5, 'text-yellow-500', 'border-yellow-200'),
    build('c4', 4, false, text.value.char4, 'text-purple-600', 'border-purple-200'),
    build('w4', 4, true, text.value.weapon4, 'text-purple-600', 'border-purple-200'),
    build('w3', 3, true, text.value.weapon3, 'text-blue-500', 'border-blue-200', true)
  ].filter(group => group.items.length)
})
</script>
