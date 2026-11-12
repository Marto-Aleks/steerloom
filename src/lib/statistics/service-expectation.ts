import type { CycleTimePoint, ServiceExpectation } from '../../types'
import type { AgingWorkItem } from './aging-work'

export function isServiceExpectation(
  value: unknown,
): value is ServiceExpectation {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  return (
    typeof item.days === 'number' &&
    Number.isFinite(item.days) &&
    item.days > 0 &&
    item.days <= 3650 &&
    typeof item.targetPercent === 'number' &&
    Number.isFinite(item.targetPercent) &&
    item.targetPercent > 0 &&
    item.targetPercent <= 100
  )
}

export function summarizeServiceExpectation(
  expectation: ServiceExpectation,
  completed: CycleTimePoint[],
  active: AgingWorkItem[],
) {
  const sample = completed.filter(
    ({ cycleTime }) => Number.isFinite(cycleTime) && cycleTime >= 0,
  )
  const within = sample.filter(
    ({ cycleTime }) => cycleTime <= expectation.days,
  ).length
  const attainmentPercent = sample.length
    ? (within / sample.length) * 100
    : null
  const beyond = active.filter(
    ({ ageInSelectedColumns }) => ageInSelectedColumns > expectation.days,
  )
  return {
    sampleCount: sample.length,
    within,
    attainmentPercent,
    meetsTarget:
      attainmentPercent === null
        ? null
        : attainmentPercent >= expectation.targetPercent,
    beyond,
  }
}
