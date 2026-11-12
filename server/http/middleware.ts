import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Connect } from 'vite'

/**
 * Adapts an async request handler to Connect. Connect ignores returned
 * promises, so a rejection would otherwise be unhandled and leave the request
 * hanging; forward it to Connect's error handler instead.
 */
export function connectMiddleware(
  handle: (
    request: IncomingMessage,
    response: ServerResponse,
    next: () => void,
  ) => Promise<void>,
): Connect.NextHandleFunction {
  return (request, response, next) => {
    handle(request, response, next).catch(next)
  }
}
