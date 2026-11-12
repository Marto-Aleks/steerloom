// @vitest-environment node
import { expect, it } from 'vitest'
import { readFigmaFiles, readFigmaInput } from './workspace-figma'

it('keeps the saved token when the field is left empty', () => {
  expect(readFigmaInput({ token: ' tok ' })).toEqual({ token: 'tok' })
  expect(readFigmaInput({}, { token: 'saved' })).toEqual({ token: 'saved' })
  expect(() => readFigmaInput({})).toThrow('Paste a Figma token')
})

it('accepts only file keys, up to ten', () => {
  expect(readFigmaFiles(['FictionalFileKey01'])).toEqual(['FictionalFileKey01'])
  expect(() => readFigmaFiles(['https://www.figma.com/x'])).toThrow()
  expect(() =>
    readFigmaFiles(Array.from({ length: 11 }, (_, i) => `FictionalKey${i}0`)),
  ).toThrow('up to 10')
})
