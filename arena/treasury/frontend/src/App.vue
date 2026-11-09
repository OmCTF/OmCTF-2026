<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import AsciiBattleCanvas from './AsciiBattleCanvas.vue'
import { currentRule, formatRoundRange, ruleWindows } from './ruleSchedule.js'

const round = ref(0)
const announcements = ref([])
const leaderboard = ref([])
const match = ref(null)
const matchCount = ref(0)
const slot = ref(0)
const rulesOpen = ref(true)
const leadersOpen = ref(true)
const ruleTab = ref('active')
const connection = ref('ЖДЁМ ЖЮРИ')
let poller = 0, requestSeq = 0
const api = `/api/v1/arena/${encodeURIComponent(window.ARENA_TASK || 'treasury')}`

const activeRules = computed(() => currentRule(announcements.value, round.value))
const nextRules = computed(() => announcements.value.find(item => item.effective_round > round.value))
const displayedRules = computed(() => ruleTab.value === 'next' ? nextRules.value : activeRules.value)
const matchIndex = computed(() => matchCount.value ? ((slot.value % matchCount.value) + matchCount.value) % matchCount.value : 0)
const unitNames = ['РУБАКА', 'ЩИТОНОСЕЦ', 'ЛУЧНИК', 'ВСАДНИК', 'САПЁР', 'РАЗВЕДЧИК', 'КОПЕЙЩИК', 'АРБАЛЕТЧИК', 'ЛЕКАРЬ', 'ИНЖЕНЕР', 'АЛХИМИК', 'ГЛАШАТАЙ']
const unitGlyphs = ['B', 'S', 'A', 'R', 'P', 'C', 'K', 'X', 'M', 'E', 'L', 'H']
const weatherNames = ['ЯСНО', 'ТУМАН НА ИРТЫШЕ', 'СНЕГ']

async function json(path) {
  const response = await fetch(path, { headers: { Accept: 'application/json' }, cache: 'no-store' })
  if (!response.ok) throw new Error(`ЖЮРИ: HTTP ${response.status}`)
  const body = await response.text()
  // Сохраняем 64-битный ключ карты без потери точности в JavaScript.
  return JSON.parse(path.endsWith('/rules') ? body.replace(/("terrain_seed"\s*:\s*)(\d+)/g, '$1"$2"') : body)
}

async function refresh(step = 0) {
  try {
    if (step && matchCount.value) slot.value = (slot.value + step + matchCount.value) % matchCount.value
    const request = ++requestSeq
    const [schedule, feed] = await Promise.all([
      json(`${api}/rules`), json(`${api}/spectate?slot=${slot.value}`),
    ])
    if (request !== requestSeq) return
    round.value = Number(schedule.round || feed.round || 0)
    announcements.value = ruleWindows(schedule.announcements || [], schedule.period_rounds)
    leaderboard.value = feed.leaderboard || []
    matchCount.value = Number(feed.match_count || 0)
    const rawMatch = feed.match
    const newMatch = rawMatch ? {
      ...rawMatch,
      trace: rawMatch.replay || rawMatch.trace,
      grade: rawMatch.replay?.grade ?? rawMatch.trace?.grade ?? rawMatch.captures?.[0] ?? 0,
    } : null
    if (step || !newMatch || !match.value || newMatch.id !== match.value.id || newMatch.round !== match.value.round)
      match.value = newMatch
    connection.value = 'СВЯЗЬ С ЖЮРИ ЕСТЬ'
  } catch (error) { connection.value = error.message }
}

function onKey(event) {
  if (event.key.toLowerCase() === 'l') leadersOpen.value = !leadersOpen.value
  if (event.key.toLowerCase() === 'r') rulesOpen.value = !rulesOpen.value
  if (event.key.toLowerCase() === 'n' || event.key === 'ArrowRight') { event.preventDefault(); refresh(1) }
  if (event.key === 'ArrowLeft') { event.preventDefault(); refresh(-1) }
  if (event.key.toLowerCase() === 't') ruleTab.value = ruleTab.value === 'active' ? 'next' : 'active'
}

onMounted(() => {
  if (window.innerWidth < 620) { rulesOpen.value = false; leadersOpen.value = false }
  refresh(); poller = window.setInterval(() => refresh(false), 12000); window.addEventListener('keydown', onKey)
})
onUnmounted(() => { window.clearInterval(poller); window.removeEventListener('keydown', onKey) })
</script>

<template>
  <main class="spectator">
    <AsciiBattleCanvas :match="match" :round="round" :weather="activeRules?.rules.weather || 0" :match-index="matchIndex" :match-count="matchCount" @cycle="refresh($event)" />
    <div class="vignette" aria-hidden="true"></div>
    <section class="window leaderboard" :class="{ closed: !leadersOpen }" aria-label="Таблица команд Казны">
      <button class="window-title" :aria-expanded="leadersOpen" @click="leadersOpen = !leadersOpen">+-- ТАБЛИЦА / КАЗНА --+ <span>[L]</span></button>
      <div v-if="leadersOpen" class="window-content">
        <div class="table-head"><span>МЕСТО / КОМАНДА</span><span>ОЧКИ</span></div>
        <div v-for="(team, index) in leaderboard" :key="team.team_id" class="standing" :class="{ first: index === 0 }">
          <span><b>{{ String(index + 1).padStart(2, '0') }}</b> {{ team.name }}</span><strong>{{ Math.round(team.score).toLocaleString('ru-RU') }}</strong>
        </div>
        <div v-if="!leaderboard.length" class="window-empty">КОМАНД ПОКА НЕТ</div>
        <div class="window-foot">БОЁВ: {{ String(matchCount).padStart(3, '0') }} / РАУНД {{ String(round).padStart(2, '0') }}</div>
      </div>
    </section>
    <section class="window rules" :class="{ closed: !rulesOpen }" aria-label="Правила Казны">
      <button class="window-title" :aria-expanded="rulesOpen" @click="rulesOpen = !rulesOpen">+-- ПРАВИЛА / ЭПОХА {{ displayedRules?.epoch ?? '?' }} --+ <span>[R]</span></button>
      <div v-if="rulesOpen" class="window-content">
        <div class="rule-tabs" aria-label="Эпохи правил">
          <button :class="{ selected: ruleTab === 'active' }" @click="ruleTab = 'active'">СЕЙЧАС {{ formatRoundRange(activeRules) }}</button>
          <button :class="{ selected: ruleTab === 'next' }" :disabled="!nextRules" @click="ruleTab = 'next'">ОБЪЯВЛЕНЫ {{ nextRules ? formatRoundRange(nextRules) : 'ПОЗЖЕ' }}</button>
        </div>
        <template v-if="displayedRules">
          <div class="rule-highlight">{{ ruleTab === 'next' ? `ОБЪЯВЛЕНЫ В РАУНДЕ ${displayedRules.announced_round} / ` : '' }}РАУНДЫ {{ formatRoundRange(displayedRules) }} / {{ weatherNames[displayedRules.rules.weather] }}</div>
          <div class="rule-row"><span>БЮДЖЕТ НАЛЁТА / СТРАЖИ</span><strong>{{ displayedRules.rules.raider_budget }} / {{ displayedRules.rules.guard_budget }}</strong></div>
          <div class="rule-row"><span>ХОДЫ / ФЛАГИ</span><strong>{{ displayedRules.rules.turns }} / 0-3</strong></div>
          <div class="rule-row"><span>ЗАПАСЫ / БРОНЯ КАЗНЫ</span><strong>{{ displayedRules.rules.supply }} / {{ displayedRules.rules.vault_armor }}</strong></div>
          <div class="rule-row"><span>КЛЮЧ КАРТЫ</span><strong>{{ displayedRules.rules.terrain_seed }}</strong></div>
          <div class="rule-row"><span>ПОРОГИ ОЦЕНКИ</span><strong>{{ displayedRules.rules.thresholds.join(' / ') }}</strong></div>
          <div class="rule-legend">БОЕЦ // ЦЕНА / ЗДОРОВЬЕ / УРОН / СКОРОСТЬ</div>
          <div class="rule-units">
            <div v-for="(name, index) in unitNames" :key="name"><span>{{ unitGlyphs[index] }} {{ name }}</span><strong>{{ displayedRules.rules.cost[index] }}/{{ displayedRules.rules.health[index] }}/{{ displayedRules.rules.damage[index] }}/{{ displayedRules.rules.speed[index] }}</strong></div>
          </div>
        </template>
        <div v-else class="window-empty">{{ ruleTab === 'next' ? 'СЛЕДУЮЩИЕ ПРАВИЛА ЕЩЁ НЕ ОБЪЯВЛЕНЫ' : 'ДЕЙСТВУЮЩИЕ ПРАВИЛА ЕЩЁ НЕ ОПУБЛИКОВАНЫ' }}</div>
        <button v-if="nextRules && ruleTab === 'active'" class="next-rule" @click="ruleTab = 'next'">СЛЕДУЮЩИЕ ПРАВИЛА // С РАУНДА {{ nextRules.effective_round }} &gt;</button>
        <button v-if="ruleTab === 'next'" class="next-rule" @click="ruleTab = 'active'">&lt; ВЕРНУТЬСЯ К ТЕКУЩИМ ПРАВИЛАМ</button>
        <div class="window-foot">{{ connection }} // ЗАЯВКИ В SKIPPER</div>
      </div>
    </section>
  </main>
</template>
