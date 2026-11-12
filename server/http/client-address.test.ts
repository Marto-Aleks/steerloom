import type { IncomingMessage } from 'node:http'
import { describe, expect, it } from 'vitest'
import { clientAddress } from './client-address'

const request = (headers: Record<string, string>, remote = '10.0.0.1') =>
  ({ headers, socket: { remoteAddress: remote } }) as unknown as IncomingMessage

describe('client address', () => {
  it('uses the socket address unless a header is explicitly trusted', () => {
    expect(
      clientAddress()(request({ 'cf-connecting-ip': '203.0.113.7' })),
    ).toBe('10.0.0.1')
    expect(
      clientAddress('CF-Connecting-IP')(
        request({ 'cf-connecting-ip': ' 203.0.113.7 ' }),
      ),
    ).toBe('203.0.113.7')
    expect(
      clientAddress('cf-connecting-ip')(
        request({ 'cf-connecting-ip': '2001:db8::1' }),
      ),
    ).toBe('2001:db8::1')
  })

  it('ignores invalid header values and refuses unsupported headers', () => {
    const resolve = clientAddress('cf-connecting-ip')
    expect(resolve(request({ 'cf-connecting-ip': 'not-an-ip' }))).toBe(
      '10.0.0.1',
    )
    expect(resolve(request({}))).toBe('10.0.0.1')
    expect(() => clientAddress('x-forwarded-for')).toThrow('supports only')
  })
})

describe('client address with an edge secret', () => {
  const resolve = clientAddress('cf-connecting-ip', 'fictional-edge-secret')
  it('trusts the header only on requests that came through the edge', () => {
    expect(
      resolve(
        request({
          'cf-connecting-ip': '203.0.113.7',
          'x-steerloom-edge': 'fictional-edge-secret',
        }),
      ),
    ).toBe('203.0.113.7')
  })
  it('counts spoofed or direct requests by their socket address', () => {
    expect(resolve(request({ 'cf-connecting-ip': '203.0.113.7' }))).toBe(
      '10.0.0.1',
    )
    expect(
      resolve(
        request({
          'cf-connecting-ip': '203.0.113.7',
          'x-steerloom-edge': 'guess',
        }),
      ),
    ).toBe('10.0.0.1')
  })
})
