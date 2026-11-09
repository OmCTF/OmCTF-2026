<script setup>
import { onMounted, onUnmounted, ref, watch } from 'vue'

const props = defineProps({ match: { type: Object, default: null }, round: { type: Number, default: 0 }, weather: { type: Number, default: 0 }, matchIndex: { type: Number, default: 0 }, matchCount: { type: Number, default: 0 } })
const emit = defineEmits(['cycle'])
const canvas = ref(null)
let ctx, backdrop, width = 0, height = 0, cols = 0, rows = 0, cellW = 8, cellH = 14
let frames = [], turnEvents = [], start = 0, lastCycle = -1, handle = 0, reducedMotion = false
const kindGlyphs = ['B', 'S', 'A', 'R', 'P', 'C', 'K', 'X', 'M', 'E', 'L', 'H']
const water = ['#164451', '#1d6170', '#298695', '#51b8bd']
const stone = ['#31514b', '#456960', '#66887a', '#9fb4a0']
const gold = ['#766239', '#ab8849', '#d4b46a', '#f3da8c']

function hash(x, y, seed = 0) {
  let value = Math.imul(x + 31, 374761393) + Math.imul(y + 17, 668265263) + seed * 2147483647
  value = Math.imul(value ^ (value >>> 13), 1274126177)
  return (value ^ (value >>> 16)) >>> 0
}

function cell(context, x, y, character, color, alpha = 1) {
  if (!character || x < 0 || y < 0 || x >= cols || y >= rows) return
  context.globalAlpha = alpha
  context.fillStyle = color
  context.fillText(character, x * cellW + 1, y * cellH + cellH * .79)
  context.globalAlpha = 1
}

function block(context, x, y, label, color) {
  for (let index = 0; index < label.length; index++) cell(context, x + index, y, label[index], color)
}

function world(x, y) {
  return { x: Math.round(cols * (.11 + (x / 23) * .79)), y: Math.round(rows * (.12 + (y / 15) * .78)) }
}

function terrain(x, y) {
  const u = x / cols, v = y / rows, noise = hash(x, y), pick = noise % 11
  const tactical = props.match?.trace?.terrain
  if (tactical?.length === 24 * 16 && u >= .09 && u <= .92 && v >= .10 && v <= .93) {
    const boardX = Math.max(0, Math.min(23, Math.round((u - .11) * 23 / .79)))
    const boardY = Math.max(0, Math.min(15, Math.round((v - .12) * 15 / .78)))
    const tile = tactical[boardY * 24 + boardX]
    if (tile === '~') return [pick < 5 ? '~' : pick < 8 ? '=' : '-', water[1 + noise % 3], .72]
    if (tile === '=') return [pick < 7 ? '=' : '+', '#b49360', .90]
    if (tile === '#') return [pick < 6 ? '#' : 'H', stone[1 + noise % 3], .93]
    if (tile === '+') return [pick < 7 ? '+' : '=', '#f1cc7d', .96]
    if (tile === '$') return [pick < 5 ? '$' : pick < 9 ? '@' : '*', gold[1 + noise % 3], .92]
    if (tile === '%') return [pick < 6 ? '%' : pick < 9 ? ':' : '.', '#8c7562', .64]
    if (tile === ':') return [pick < 6 ? ':' : pick < 9 ? ',' : '.', '#52645b', .58]
    return [pick < 2 ? ':' : pick < 6 ? '.' : pick < 8 ? ',' : ' ', stone[noise % 3], .37]
  }
  const river = .18 + Math.sin(v * 8.6) * .034 + Math.sin(v * 18.1) * .011
  if (u < river || (v < .09 + Math.sin(u * 9) * .025 && u < .36))
    return [pick < 4 ? '~' : pick < 7 ? '=' : pick < 9 ? '-' : '.', water[Math.min(3, (noise >>> 8) % 4)], .58 + (noise % 4) * .09]

  const dx = (u - .54) / .285, dy = (v - .545) / .345, distance = Math.hypot(dx, dy)
  const westGate = Math.abs(v - .545) < .05 && u < .33
  const southGate = Math.abs(u - .54) < .043 && v > .83
  if (distance > .93 && distance < 1.065) {
    if (westGate || southGate) return [noise % 3 ? '=' : '+', gold[1 + noise % 2], .95]
    return [pick < 2 ? '%' : pick < 7 ? '#' : 'H', stone[1 + noise % 3], .88]
  }
  if (distance <= .93) {
    const vault = Math.hypot((u - .54) / .105, (v - .545) / .145)
    if (vault > .78 && vault < 1.12) return [noise % 5 ? '#' : '@', gold[1 + noise % 3], .95]
    if (vault <= .78) return [pick < 3 ? '$' : pick < 6 ? '*' : pick < 9 ? ':' : '.', gold[Math.min(3, (noise >>> 7) % 4)], .65]
    if (Math.abs(u - .54) < .008 || Math.abs(v - .545) < .013) return [noise % 2 ? ':' : '.', '#5e8c75', .73]
    return [pick < 2 ? ':' : pick < 6 ? '.' : pick < 8 ? ',' : ' ', stone[noise % 3], .38]
  }

  const road = Math.abs(v - (.55 + Math.sin(u * 9) * .015)) < .018 || Math.abs(u - .54) < .009
  if (road) return [pick < 6 ? '.' : ':', stone[noise % 3], .55]
  if ((u > .80 && u < .94 && v > .18 && v < .34) || (u > .80 && u < .94 && v > .72 && v < .87))
    return [pick < 4 ? '#' : pick < 8 ? '=' : '+', stone[noise % 3], .5]
  return [pick < 2 ? '.' : pick < 4 ? ',' : pick < 5 ? ':' : ' ', stone[noise % 3], .25]
}

function rebuildBackdrop() {
  if (!canvas.value) return
  width = Math.max(320, window.innerWidth); height = Math.max(320, window.innerHeight)
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
  canvas.value.width = Math.floor(width * pixelRatio)
  canvas.value.height = Math.floor(height * pixelRatio)
  canvas.value.style.width = `${width}px`; canvas.value.style.height = `${height}px`
  ctx = canvas.value.getContext('2d', { alpha: false })
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
  cellW = width < 780 ? 7 : width > 1700 ? 8.8 : 8.1
  cellH = width < 780 ? 12 : width > 1700 ? 15 : 14
  cols = Math.ceil(width / cellW); rows = Math.ceil(height / cellH)
  backdrop = document.createElement('canvas'); backdrop.width = width; backdrop.height = height
  const background = backdrop.getContext('2d', { alpha: false })
  background.fillStyle = '#030c12'; background.fillRect(0, 0, width, height)
  background.font = `bold ${Math.floor(cellH * .82)}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`
  background.textBaseline = 'alphabetic'
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const [character, color, alpha] = terrain(x, y)
    cell(background, x, y, character, color, alpha)
  }
  const posts = [[2, 3], [2, 12], [21, 12], [9, 5], [15, 5], [12, 10]]
  for (const [x, y] of posts) {
    const position = world(x, y)
    block(background, position.x - 2, position.y, '+-+-+', '#c2a265')
    cell(background, position.x, position.y - 1, '|', '#b9a36c')
  }
  block(background, Math.round(cols * .48) - 7, Math.round(rows * .55), '[ К А З Н А ]', '#f0d58a')
  // Fine outer frame belongs to the battlefield itself, not to a UI panel.
  for (let x = 2; x < cols - 2; x++) {
    cell(background, x, 2, x % 9 === 0 ? '+' : '-', '#174d50', .75)
    cell(background, x, rows - 3, x % 9 === 0 ? '+' : '-', '#174d50', .75)
  }
  for (let y = 3; y < rows - 3; y++) {
    cell(background, 2, y, '|', '#174d50', .75)
    cell(background, cols - 3, y, '|', '#174d50', .75)
  }
}

function prepareTrace() {
  const trace = props.match?.trace
  const turns = Math.max(1, Math.min(24, Number(trace?.turns) || 16))
  frames = Array.from({ length: turns + 1 }, () => [])
  turnEvents = Array.from({ length: turns + 1 }, () => [])
  const grouped = Array.from({ length: turns + 1 }, () => [])
  for (const event of trace?.events || []) if (event.turn >= 1 && event.turn <= turns) grouped[event.turn].push(event)
  const units = new Map()
  for (let turn = 1; turn <= turns; turn++) {
    for (const event of grouped[turn]) {
      if (event.type === 'move') units.set(event.id, { ...event })
      if (event.type === 'fallen') units.delete(event.id)
      if (event.type !== 'move') turnEvents[turn].push(event)
    }
    frames[turn] = [...units.values()].map(unit => ({ ...unit }))
  }
  start = performance.now(); lastCycle = -1
}

function drawUnit(unit, previous, progress, now) {
  const from = previous?.find(other => other.id === unit.id) || unit
  const ease = progress * progress * (3 - 2 * progress)
  const x = from.x + (unit.x - from.x) * ease
  const y = from.y + (unit.y - from.y) * ease
  const point = world(x, y)
  const offset = (unit.id % 3 - 1) * .48
  const px = (point.x + offset) * cellW, py = point.y * cellH
  const raider = unit.side === 'raider'
  const color = unit.carrying ? '#ffe79c' : raider ? '#ff7969' : '#7ef3cb'
  const edge = raider ? '#783b3d' : '#315f59'
  const symbol = unit.carrying ? '$' : kindGlyphs[unit.kind] || (raider ? 'R' : 'G')
  const bob = Math.sin(now / 175 + unit.id * 1.8) * 1.5
  ctx.save()
  ctx.shadowColor = color; ctx.shadowBlur = unit.carrying ? 22 : 13
  ctx.font = `bold ${Math.max(14, cellH * 1.24)}px ui-monospace, Menlo, Consolas, monospace`
  ctx.fillStyle = edge; ctx.fillText(raider ? '< >' : '[ ]', px - cellW * 1.45, py + bob)
  ctx.fillStyle = color; ctx.fillText(symbol, px - cellW * .24, py + bob)
  if (unit.suppressed > 0) { ctx.fillStyle = '#ffc763'; ctx.fillText('!', px + cellW * .85, py - cellH * .7 + bob) }
  if (unit.entrenched) { ctx.fillStyle = '#c5b885'; ctx.fillText('#', px - cellW * .28, py + cellH * .7 + bob) }
  ctx.restore()
  if (unit.hp > 0) {
    ctx.fillStyle = color
    ctx.globalAlpha = .75
    ctx.fillRect(px - cellW * .75, py + cellH * .36, Math.min(1, unit.hp / 16) * cellW * 1.5, 2)
    ctx.globalAlpha = 1
  }
}

function drawEffects(events, phase, now) {
  for (const event of events) {
    if (event.type === 'smoke') {
      const point = world(Number(event.x) || 12, Number(event.y) || 7)
      ctx.save(); ctx.font = `bold ${cellH}px ui-monospace, Menlo, Consolas, monospace`; ctx.fillStyle = '#91b6aa'
      for (let i = 0; i < 15; i++) {
        const angle = i * 2.4 + now / 1000, radius = 4 + i % 5 * 4
        ctx.globalAlpha = (1 - phase) * .35
        ctx.fillText(i % 3 ? ':' : '~', point.x * cellW + Math.cos(angle) * radius, point.y * cellH + Math.sin(angle) * radius)
      }
      ctx.restore(); continue
    }
    const point = event.type === 'breach' ? world(12, 7) : world(Number(event.x) || 12, Number(event.y) || 7)
    const explosive = ['breach', 'fallen', 'charge_detonated', 'mine_trigger'].includes(event.type)
    const healing = ['heal', 'repair', 'rally', 'charge_disarmed'].includes(event.type)
    const color = explosive ? '#ff715c' : healing ? '#78ffd0' : event.type === 'strike' || event.type === 'suppress' ? '#ffd078' : '#8ffff1'
    const count = explosive ? 12 : 6
    ctx.save(); ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 15
    ctx.font = `bold ${cellH * 1.13}px ui-monospace, Menlo, Consolas, monospace`
    for (let i = 0; i < count; i++) {
      const angle = i * 6.283 / count + now / 420
      const distance = (5 + i % 3 * 3) * (1 - phase * .48)
      ctx.globalAlpha = (1 - phase) * (.45 + i % 3 * .15)
      ctx.fillText(i % 3 ? '*' : '+', point.x * cellW + Math.cos(angle) * distance, point.y * cellH + Math.sin(angle) * distance)
    }
    ctx.restore()
  }
}

function draw(now) {
  if (!ctx || !backdrop) return
  ctx.drawImage(backdrop, 0, 0)
  const trace = props.match?.trace
  const turns = Math.max(1, Math.min(24, Number(trace?.turns) || 16))
  const duration = reducedMotion ? 1 : 760
  const elapsed = reducedMotion ? 0 : Math.max(0, now - start)
  const turn = trace ? 1 + Math.floor(elapsed / duration) % turns : 1
  const phase = trace ? (elapsed % duration) / duration : 0
  const cycle = Math.floor(elapsed / (turns * duration))
  if (trace && cycle > lastCycle) {
    if (lastCycle >= 0) emit('cycle', 1)
    lastCycle = cycle
  }
  const units = trace ? frames[turn] || [] : [
    { id: 100, side: 'guard', x: 9, y: 5, hp: 16 }, { id: 101, side: 'guard', x: 15, y: 5, hp: 16 },
    { id: 102, side: 'guard', x: 12, y: 10, hp: 16 },
  ]
  for (const unit of units) drawUnit(unit, frames[turn - 1], phase, now)
  if (trace) for (const event of trace.events || []) if (event.turn <= turn && event.type === 'fortify' && event.kind === 9) {
    const point = world(event.x, event.y)
    ctx.save(); ctx.fillStyle = '#b7a976'; ctx.shadowColor = '#e4c878'; ctx.shadowBlur = 9
    ctx.font = `bold ${cellH * 1.1}px ui-monospace, Menlo, Consolas, monospace`
    ctx.fillText('B', point.x * cellW, point.y * cellH); ctx.restore()
  }
  if (trace) drawEffects(turnEvents[turn] || [], phase, now)

  const top = props.match ? `КАЗНА // ${props.match.attacker_name} > ${props.match.defender_name}` : 'КАЗНА // ОМСКИЙ ГОСБАНК // ЖДЁМ БОЁВ'
  const bottom = props.match
    ? width < 760
      ? `Р ${String(props.match.round).padStart(2, '0')} / Х ${String(turn).padStart(2, '0')}:${String(turns).padStart(2, '0')} / КАЗНА ${Math.max(0, Number(trace?.vault_integrity) || 0)}% / ${props.match.grade}/3`
      : `РАУНД ${String(props.match.round).padStart(2, '0')}  /  ХОД ${String(turn).padStart(2, '0')}:${String(turns).padStart(2, '0')}  /  КАЗНА ${Math.max(0, Number(trace?.vault_integrity) || 0)}%  /  СНЯТО ПЕЧАТЕЙ: ${props.match.grade}/3`
    : `РАУНД ${String(props.round).padStart(2, '0')}  /  ИРТЫШ + ОМЬ  /  ЖДЁМ ПЕРВЫЙ БОЙ`
  ctx.save()
  ctx.font = `bold ${Math.max(12, cellH * .88)}px ui-monospace, Menlo, Consolas, monospace`
  ctx.shadowColor = '#62e5ba'; ctx.shadowBlur = 9
  ctx.fillStyle = '#a5f9d4'; ctx.textAlign = 'center'
  if (width >= 1000) ctx.fillText(top.slice(0, Math.floor(cols * .6)), width / 2, cellH * 4.7)
  ctx.fillStyle = '#f6dc90'; ctx.fillText(bottom, width / 2, height - cellH * 1.05)
  if (props.matchCount > 1) {
    ctx.fillStyle = '#8beac7'
    const help = width < 760 ? `БОЙ ${props.matchIndex + 1}/${props.matchCount}  < НАЖМИ ДЛЯ СМЕНЫ >`
      : `БОЙ ${props.matchIndex + 1}/${props.matchCount}  < КЛИК СЛЕВА / СПРАВА ИЛИ СТРЕЛКИ >`
    ctx.fillText(help, width / 2, height - cellH * 2.45)
  }
  ctx.restore()
  // Тонкая строка сканера не закрывает поле боя.
  if (!reducedMotion) {
    const scanner = (now / 49) % height
    ctx.fillStyle = 'rgba(91, 237, 196, .025)'; ctx.fillRect(0, scanner, width, 2)
  }
}

function loop(now) { draw(now); handle = requestAnimationFrame(loop) }
function onBattleClick(event) {
  if (props.matchCount < 2) return
  emit('cycle', event.clientX < window.innerWidth / 2 ? -1 : 1)
}
watch(() => props.match, () => { rebuildBackdrop(); prepareTrace() })
onMounted(() => {
  reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  rebuildBackdrop(); prepareTrace()
  window.addEventListener('resize', rebuildBackdrop)
  handle = requestAnimationFrame(loop)
})
onUnmounted(() => { cancelAnimationFrame(handle); window.removeEventListener('resize', rebuildBackdrop) })
</script>

<template><canvas ref="canvas" class="battle-canvas" role="img" :aria-label="`Бой за Казну. Нападение: ${match?.attacker_name || 'ждём команду'}. Оборона: ${match?.defender_name || 'ждём команду'}. Бой ${matchIndex + 1} из ${matchCount}. Нажмите слева или справа от центра поля либо используйте стрелки для смены боя.`" @click="onBattleClick" /></template>
