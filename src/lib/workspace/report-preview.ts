import type { FlowBoardSnapshot } from '../../types'
import { demoSnapshot } from './demo'

/** Deterministic, entirely fictional history for the public chart previews. */
export function reportPreviewSnapshot(): FlowBoardSnapshot {
  const anchor = new Date('2026-10-05T00:00:00Z')
  const base = demoSnapshot('demo-product', anchor)
  const date = (daysAgo: number) =>
    new Date(anchor.getTime() - daysAgo * 86_400_000).toISOString()
  const issues: FlowBoardSnapshot['issues'] = []
  const transitions: FlowBoardSnapshot['transitions'] = []
  const weeklyCounts = [4, 7, 3, 8, 5, 9, 2, 6, 11, 5, 7, 5]
  for (let index = 0; index < 72; index++) {
    const id = `report-example-${index + 1}`
    const duration =
      index % 19 === 0
        ? 195 + index
        : index % 7 === 0
          ? 64 + index
          : 1 + ((index * 11) % 45)
    let position = index
    let week = 0
    while (position >= weeklyCounts[week]!) {
      position -= weeklyCounts[week]!
      week++
    }
    const finished = week * 7 + 0.5 + position * (6 / weeklyCounts[week]!)
    issues.push({
      id,
      key: `EXAMPLE-${index + 1}`,
      createdAt: date(finished + duration + 3),
      issueTypeId: 'story',
      issueTypeName: 'Story',
    })
    transitions.push(
      {
        issueId: id,
        statusId: 'stage-0',
        enteredAt: date(finished + duration + 3),
      },
      {
        issueId: id,
        statusId: 'stage-1',
        enteredAt: date(finished + duration),
      },
      {
        issueId: id,
        statusId: 'stage-2',
        enteredAt: date(finished + duration * 0.2),
      },
      { issueId: id, statusId: 'stage-3', enteredAt: date(finished) },
    )
  }
  return { ...base, issues, transitions }
}
