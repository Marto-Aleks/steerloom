// @vitest-environment node
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { diskSessionStore } from './session-store'
const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true })
})
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'steerloom-session-test-'))
  dirs.push(dir)
  return join(dir, 'sessions.enc')
}
const key = Buffer.alloc(32, 1)
const session = () => ({
  expires: Date.now() + 100000,
  tokens: {
    accessToken: 'fictional-access',
    refreshToken: 'fictional-refresh',
    expiresAt: Date.now() + 10000,
  },
})
it('restores encrypted sessions on restart without persisting plaintext tokens', () => {
  const file = setup(),
    value = session()
  diskSessionStore(file, key).save([['ab'.repeat(32), value]])
  expect(readFileSync(file, 'utf8')).not.toMatch(
    /fictional|accessToken|refreshToken/,
  )
  expect(diskSessionStore(file, key).load()).toEqual([['ab'.repeat(32), value]])
  diskSessionStore(file, key).save([])
  expect(diskSessionStore(file, key).load()).toEqual([])
})
it('drops expired sessions', () => {
  const file = setup()
  diskSessionStore(file, key).save([
    ['ab'.repeat(32), { ...session(), expires: Date.now() - 1 }],
  ])
  expect(diskSessionStore(file, key).load()).toEqual([])
})
it('starts with no sessions on a wrong key or a damaged file, keeping the file aside', () => {
  const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
  const file = setup(),
    value = session()
  diskSessionStore(file, key).save([['ab'.repeat(32), value]])
  const saved = readFileSync(file, 'utf8')
  // A changed credential key: the server still starts, signed out.
  expect(diskSessionStore(file, Buffer.alloc(32, 2)).load()).toEqual([])
  expect(existsSync(file)).toBe(false)
  expect(readFileSync(`${file}.unreadable`, 'utf8')).toBe(saved)
  // Putting the right key and the file back restores the sessions.
  writeFileSync(file, saved)
  expect(diskSessionStore(file, key).load()).toEqual([['ab'.repeat(32), value]])
  writeFileSync(file, 'tampered')
  expect(diskSessionStore(file, key).load()).toEqual([])
  expect(quiet).toHaveBeenCalledTimes(2)
  // Nothing readable is logged: only that the file could not be read.
  expect(JSON.stringify(quiet.mock.calls)).not.toMatch(/fictional/)
  quiet.mockRestore()
})
