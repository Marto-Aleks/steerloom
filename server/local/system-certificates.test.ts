// @vitest-environment node
import { expect, it } from 'vitest'
import { trustSystemCertificates } from './system-certificates'

it('adds the computer’s certificates to Node’s list once', () => {
  let set: string[] = []
  const added = trustSystemCertificates({
    getCACertificates: (type) =>
      type === 'system'
        ? ['company-ca', 'shared-ca']
        : ['shared-ca', 'root-ca'],
    setDefaultCACertificates: (certificates) => {
      set = certificates
    },
  })
  expect(added).toBe(2)
  expect(set.sort()).toEqual(['company-ca', 'root-ca', 'shared-ca'])
})

it('leaves older Node versions and unreadable stores alone', () => {
  expect(trustSystemCertificates({})).toBe(0)
  expect(
    trustSystemCertificates({
      getCACertificates: () => {
        throw new Error('no store')
      },
      setDefaultCACertificates: () => undefined,
    }),
  ).toBe(0)
})
