// @vitest-environment node
import { expect, it } from 'vitest'
import type { AiItemPullRequests } from '../../src/lib/ai/pull-request-evidence'
import { codeTool, newToolUsage, runCodeTool } from './agent-tools'

const lookup: AiItemPullRequests[] = [
  {
    key: 'FLOW-1',
    stage: 'In progress',
    daysInStage: 40,
    code: 'coding',
    branchLastCommitDaysAgo: 30,
    codeQuietDays: 30,
    pullRequests: [],
  },
  {
    key: 'FLOW-2',
    stage: 'Review',
    code: 'review',
    pullRequests: [
      {
        ref: 'acme/web#7',
        state: 'open',
        readyDaysAgo: 6,
        changesRequested: 0,
        comments: 3,
      },
    ],
  },
]
const call = (keys: unknown) => ({ id: 'c1', name: 'get_code', args: { keys } })

it('describes a read-only lookup that names no people', () => {
  const tool = codeTool('FLOW-12')
  expect(tool.name).toBe('get_code')
  expect(tool.description).toMatch(/read-only/)
  expect(tool.description).toMatch(/No people and no comment text/)
})

it('returns the trail of the asked keys and names the ones with no code', () => {
  const usage = newToolUsage()
  const result = JSON.parse(
    runCodeTool(lookup, call(['flow-2', 'FLOW-9']), usage).content,
  ) as { items: AiItemPullRequests[]; no_code_found: string[] }
  expect(result.items.map((item) => item.key)).toEqual(['FLOW-2'])
  expect(result.no_code_found).toEqual(['FLOW-9'])
  expect(usage.code).toBe(2)
})

it('stops at the per-answer budget', () => {
  const usage = { ...newToolUsage(), code: 30 }
  expect(runCodeTool(lookup, call(['FLOW-1']), usage).content).toMatch(
    /limit for this answer is used up/,
  )
  expect(runCodeTool(lookup, call([]), newToolUsage()).content).toMatch(
    /Give item keys/,
  )
})
