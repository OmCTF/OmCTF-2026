export function ruleWindows(announcements, periodRounds = 0) {
  const ordered = [...announcements].sort((a, b) => a.effective_round - b.effective_round)
  return ordered.map((rule, index) => ({
    ...rule,
    epoch: rule.epoch ?? (periodRounds > 0 ? Math.floor((rule.effective_round - 1) / periodRounds) : index),
    end_round: rule.end_round >= rule.effective_round
      ? rule.end_round
      : (ordered[index + 1] ? ordered[index + 1].effective_round - 1 : null),
  }))
}

export function currentRule(windows, round) {
  const active = windows.findLast(rule => rule.effective_round <= round)
  return active && (active.end_round == null || round <= active.end_round) ? active : null
}

export function formatRoundRange(rule) {
  if (!rule) return ''
  if (rule.end_round == null) return `С ${rule.effective_round}`
  return rule.end_round === rule.effective_round
    ? String(rule.effective_round)
    : `${rule.effective_round}-${rule.end_round}`
}
