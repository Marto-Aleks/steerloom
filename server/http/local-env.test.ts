// @vitest-environment node
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { localEnvironment } from './local-env'

it('reads the env files in Vite order and lets the process environment win', () => {
  const dir = mkdtempSync(join(tmpdir(), 'steerloom-env-'))
  writeFileSync(join(dir, '.env'), 'A=base\nB=base\nC=base\n')
  writeFileSync(join(dir, '.env.local'), 'B=local\nC=local\n')
  writeFileSync(join(dir, '.env.development.local'), 'C="dev local"\n')
  const env = localEnvironment(dir, { A: 'process' })
  expect(env).toMatchObject({ A: 'process', B: 'local', C: 'dev local' })
})
