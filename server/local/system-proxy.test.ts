// @vitest-environment node
import { expect, it } from 'vitest'
import {
  parseScutilBypass,
  parseScutilProxy,
  parseWindowsBypass,
  parseWindowsProxy,
} from './system-proxy'

it('reads the macOS HTTPS proxy, then HTTP, and ignores disabled ones', () => {
  const mac = `<dictionary> {
  HTTPEnable : 1
  HTTPPort : 8080
  HTTPProxy : proxy.example.invalid
  HTTPSEnable : 1
  HTTPSPort : 3128
  HTTPSProxy : localhost
  ProxyAutoConfigEnable : 1
}`
  expect(parseScutilProxy(mac)).toBe('http://localhost:3128')
  expect(
    parseScutilProxy(mac.replace('HTTPSEnable : 1', 'HTTPSEnable : 0')),
  ).toBe('http://proxy.example.invalid:8080')
  expect(
    parseScutilProxy('<dictionary> {\n  ProxyAutoConfigEnable : 1\n}'),
  ).toBe('')
})

it('reads the Windows proxy in both formats and only when enabled', () => {
  const on = (server: string) =>
    `    ProxyEnable    REG_DWORD    0x1\n    ProxyServer    REG_SZ    ${server}\n`
  expect(parseWindowsProxy(on('proxy.example.invalid:8080'))).toBe(
    'http://proxy.example.invalid:8080',
  )
  expect(
    parseWindowsProxy(
      on('http=web.example.invalid:80;https=secure.example.invalid:443'),
    ),
  ).toBe('http://secure.example.invalid:443')
  expect(
    parseWindowsProxy(on('proxy.example.invalid:8080').replace('0x1', '0x0')),
  ).toBe('')
})

it('reads the addresses the computer reaches without its proxy', () => {
  const mac = `<dictionary> {
  ExceptionsList : <array> {
    0 : *.local
    1 : 169.254/16
    2 : *.example.invalid
  }
  ExcludeSimpleHostnames : 1
  HTTPSEnable : 1
}`
  expect(parseScutilBypass(mac)).toBe('*.local,169.254/16,*.example.invalid')
  expect(parseScutilBypass('<dictionary> {\n  HTTPSEnable : 1\n}')).toBe('')
  expect(
    parseWindowsBypass(
      '    ProxyOverride    REG_SZ    *.example.invalid;10.*;<local>\n',
    ),
  ).toBe('*.example.invalid,10.*')
})
