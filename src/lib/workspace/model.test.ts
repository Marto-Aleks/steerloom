import { describe, expect, it } from 'vitest'
import { parseFigmaFiles, readDashboard } from './model'

const dashboard = {
  id: 'sample:1',
  name: 'Delivery',
  provider: 'demo',
  connectionId: 'demo',
  boardId: 'demo-product',
  filters: { ticketTypes: [], selectedColumnIds: ['active'], windowDays: 30 },
  metrics: ['median-cycle-time'],
}
describe('dashboard configuration', () => {
  it('still loads a dashboard saved with a daily or weekly review', () => {
    // Every briefing shows all its numbers now; older saved choices are read
    // and ignored, not refused.
    const daily = readDashboard({
      ...dashboard,
      reviewMode: 'daily',
      metrics: ['aging-wip', 'percentile-85', 'exit-throughput'],
    })
    expect(daily.reviewMode).toBe('daily')
    expect(daily.boardId).toBe('demo-product')
    expect(() =>
      readDashboard({ ...dashboard, reviewMode: 'invented' }),
    ).toThrow()
  })
  it('persists optional team expectations', () => {
    const serviceExpectation = { days: 7, targetPercent: 85 }
    const saved = readDashboard({
      ...dashboard,
      filters: {
        ...dashboard.filters,
        serviceExpectation: { ...serviceExpectation, secret: 'discard' },
      },
    })
    expect(saved.filters.serviceExpectation).toEqual(serviceExpectation)
    expect(readDashboard(dashboard).filters.serviceExpectation).toBeUndefined()
    for (const invalid of [
      null,
      { days: 0, targetPercent: 85 },
      { days: 7, targetPercent: 101 },
    ])
      expect(() =>
        readDashboard({
          ...dashboard,
          filters: { ...dashboard.filters, serviceExpectation: invalid },
        }),
      ).toThrow()
  })

  it('retains only allowed configuration and never imported rows or secrets', () => {
    const saved = readDashboard({
      ...dashboard,
      rows: [{ title: 'Fictional row' }],
      token: 'fictional-secret',
      filters: { ...dashboard.filters, credentials: 'secret' },
    })
    expect(saved).toEqual(dashboard)
    expect(JSON.stringify(saved)).not.toMatch(/rows|title|token|credentials/)
  })
  it('validates metrics and finite analysis periods', () => {
    for (const windowDays of [-1, 0, NaN, 0.5, 5000, '30'])
      expect(() =>
        readDashboard({
          ...dashboard,
          filters: { ...dashboard.filters, windowDays },
        }),
      ).toThrow()
    expect(() => readDashboard({ ...dashboard, metrics: [] })).toThrow()
    expect(() =>
      readDashboard({ ...dashboard, metrics: ['invented-metric'] }),
    ).toThrow()
    expect(
      readDashboard({
        ...dashboard,
        metrics: ['median-cycle-time', 'median-cycle-time'],
      }).metrics,
    ).toEqual(['median-cycle-time'])
  })

  it('keeps short team notes, drops blank ones and rejects a document', () => {
    expect(
      readDashboard({ ...dashboard, teamNotes: '  We do not run stand-ups. ' })
        .teamNotes,
    ).toBe('We do not run stand-ups.')
    expect(
      readDashboard({ ...dashboard, teamNotes: '   ' }),
    ).not.toHaveProperty('teamNotes')
    expect(() =>
      readDashboard({ ...dashboard, teamNotes: 'x'.repeat(601) }),
    ).toThrow()
    expect(() => readDashboard({ ...dashboard, teamNotes: 42 })).toThrow()
  })
})

describe('saved dashboards from before workspace repositories', () => {
  it('drop a dashboard’s old repository list', () => {
    expect(
      readDashboard({ ...dashboard, repositories: ['acme/web'] }),
    ).not.toHaveProperty('repositories')
  })
})

describe('dashboard Figma files', () => {
  it('reads file and branch links as the main file key, once each', () => {
    expect(
      parseFigmaFiles(
        'https://www.figma.com/design/FictionalFileKey01/Checkout?node-id=1-2, ' +
          'https://www.figma.com/design/FictionalFileKey01/branch/FictionalBranch99/x\n' +
          'FictionalFileKey02 https://example.invalid/nope',
      ),
    ).toEqual(['FictionalFileKey01', 'FictionalFileKey02'])
  })
  it('keeps valid file keys and refuses invalid ones', () => {
    expect(
      readDashboard({ ...dashboard, figmaFiles: ['FictionalFileKey01'] })
        .figmaFiles,
    ).toEqual(['FictionalFileKey01'])
    expect(() =>
      readDashboard({ ...dashboard, figmaFiles: ['not a key'] }),
    ).toThrow()
  })
})
