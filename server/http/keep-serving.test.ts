// @vitest-environment node
import { EventEmitter } from 'node:events'
import { expect, it, vi } from 'vitest'
import { keepServing, UNEXPECTED_ERROR } from './keep-serving'

it('logs an unexpected error and keeps the process serving', () => {
  const target = new EventEmitter()
  const log = vi.fn()
  const exit = vi.fn()
  keepServing({ target, log, exit })
  const failure = new Error('fictional failure')
  target.emit('unhandledRejection', failure)
  target.emit('uncaughtException', failure)
  expect(log).toHaveBeenCalledWith(
    UNEXPECTED_ERROR,
    'unhandled rejection',
    failure,
  )
  expect(log).toHaveBeenCalledWith(
    UNEXPECTED_ERROR,
    'uncaught exception',
    failure,
  )
  expect(exit).not.toHaveBeenCalled()
})

it('stops for a fresh start only when errors come in a burst', () => {
  const target = new EventEmitter()
  const exit = vi.fn()
  let time = 0
  keepServing({ target, log: () => {}, exit, now: () => time })
  // Nineteen spread over an hour: nothing stops.
  for (let i = 0; i < 19; i++) {
    time += 3 * 60_000
    target.emit('uncaughtException', new Error('fictional'))
  }
  expect(exit).not.toHaveBeenCalled()
  // Twenty within one minute: the process is in trouble.
  for (let i = 0; i < 20; i++) {
    time += 1000
    target.emit('uncaughtException', new Error('fictional'))
  }
  expect(exit).toHaveBeenCalledWith(1)
})
