import { randomBytes } from 'node:crypto'
import type { ServerResponse } from 'node:http'

// Provider callbacks return via a same-origin script so the SameSite=Strict
// session cookie is sent on the next navigation. Destinations are fixed paths.
export function sendReturnPage(response: ServerResponse, destination: string) {
  const nonce = randomBytes(16).toString('base64')
  response.setHeader('Content-Type', 'text/html; charset=utf-8')
  response.setHeader(
    'Content-Security-Policy',
    `default-src 'none'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'`,
  )
  response.end(
    `<!doctype html><html lang="en"><meta charset="utf-8"><title>Steerloom</title><script nonce="${nonce}">location.replace(${JSON.stringify(destination)})</script><a href="/?hosted=1">Continue</a></html>`,
  )
}
