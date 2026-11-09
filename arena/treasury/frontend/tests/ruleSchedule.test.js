import assert from 'node:assert/strict'
import test from 'node:test'
import { currentRule, formatRoundRange, ruleWindows } from '../src/ruleSchedule.js'

test('uses configured epoch boundaries and selects the latest applicable rules', () => {
  const schedule = ruleWindows([
    { effective_round: 8, end_round: 11 },
    { effective_round: 1, end_round: 7 },
    { effective_round: 12, end_round: 12 },
  ])
  assert.equal(currentRule(schedule, 7).effective_round, 1)
  assert.equal(currentRule(schedule, 8).effective_round, 8)
  assert.equal(formatRoundRange(currentRule(schedule, 8)), '8-11')
  assert.equal(formatRoundRange(currentRule(schedule, 12)), '12')
  assert.equal(currentRule(schedule, 13), null)
})

test('infers the previous end only when the next version is available', () => {
  const schedule = ruleWindows([{ effective_round: 1 }, { effective_round: 9 }])
  assert.equal(formatRoundRange(currentRule(schedule, 6)), '1-8')
  assert.equal(formatRoundRange(currentRule(schedule, 9)), 'С 9')
  assert.equal(currentRule(schedule, 0), null)
})

test('uses the configured period for the epoch number even if earlier versions are missing', () => {
  const schedule = ruleWindows([{ effective_round: 15, end_round: 21 }], 7)
  assert.equal(currentRule(schedule, 15).epoch, 2)
})
