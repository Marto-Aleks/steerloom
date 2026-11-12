import { request } from 'node:http'

// Node's fetch normalizes Host. Use HTTP directly to test reverse-proxy traffic.
export function proxyRequest(
  url: string,
  options: {
    method?: string
    headers?: Record<string, string>
    body?: string
  } = {},
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      { method: options.method ?? 'GET', headers: options.headers },
      (response) => {
        const parts: Buffer[] = []
        response.on('data', (part: Buffer) => parts.push(part))
        response.on('error', reject)
        response.on('end', () => {
          const headers = new Headers()
          for (const [key, value] of Object.entries(response.headers)) {
            if (Array.isArray(value))
              value.forEach((item) => headers.append(key, item))
            else if (value !== undefined) headers.set(key, value)
          }
          resolve(
            new Response(Buffer.concat(parts), {
              status: response.statusCode,
              headers,
            }),
          )
        })
      },
    )
    req.on('error', reject)
    req.end(options.body)
  })
}
