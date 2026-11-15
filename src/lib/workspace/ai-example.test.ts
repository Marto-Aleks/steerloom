import { expect, it } from 'vitest'
import { parseAiExample } from './ai-example'

it('reads an Azure OpenAI example: address with api-version, api-key header, deployment as model', () => {
  const example =
    parseAiExample(`curl -X POST "https://aoai.example.com/api/openai/deployments/gpt-5-nano/chat/completions?api-version=2025-04-01-preview" \\
  -H "Content-Type: application/json" \\
  -H "api-key: $AZURE_KEY" \\
  -d '{"messages":[{"role":"user","content":"hi"}]}'`)
  expect(example).toEqual({
    endpoint:
      'https://aoai.example.com/api/openai/deployments/gpt-5-nano/chat/completions?api-version=2025-04-01-preview',
    model: 'gpt-5-nano',
    format: 'openai',
    keyHeader: 'api-key',
  })
})

it('reads a Gemini example: the model comes out of the path, the base stays', () => {
  const example =
    parseAiExample(`curl 'https://gw.example.com/api/google/v1/models/gemini-2.5-pro:generateContent' \\
  -H 'x-goog-api-key: PLACEHOLDER' -H 'Content-Type: application/json' \\
  -X POST -d '{"contents":[{"parts":[{"text":"hi"}]}]}'`)
  expect(example).toEqual({
    endpoint: 'https://gw.example.com/api/google/v1',
    model: 'gemini-2.5-pro',
    format: 'gemini',
    keyHeader: 'x-goog-api-key',
  })
})

it('reads an Anthropic example and a plain Bearer gateway example', () => {
  expect(
    parseAiExample(
      `curl https://gw.example.com/anthropic/v1/messages -H "x-api-key: K" -H "anthropic-version: 2023-06-01" -d '{"model":"claude-sonnet-5-5","max_tokens":64,"messages":[]}'`,
    ),
  ).toEqual({
    endpoint: 'https://gw.example.com/anthropic/v1/messages',
    model: 'claude-sonnet-5-5',
    format: 'anthropic',
    keyHeader: 'x-api-key',
  })
  expect(
    parseAiExample(
      `curl https://gw.example.com/v1/chat/completions -H "Authorization: Bearer $KEY" -d '{"model": "company-model", "messages": []}'`,
    ),
  ).toMatchObject({
    format: 'openai',
    keyHeader: 'authorization',
    model: 'company-model',
  })
})

it('names formats Steerloom does not speak, and copes with no example at all', () => {
  expect(
    parseAiExample(
      `curl https://api.openai.com/v1/responses -H "Authorization: Bearer x" -d '{"model":"gpt-5","input":"hi"}'`,
    ),
  ).toMatchObject({ unsupported: 'the OpenAI Responses API', model: 'gpt-5' })
  expect(parseAiExample('just some words')).toEqual({ keyHeader: undefined })
})

it('reads Claude on Vertex behind a gateway, but not Google’s own Vertex address', () => {
  expect(
    parseAiExample(
      `curl -X POST "https://gw.example.com/api/google/v1/publishers/anthropic/models/claude-sonnet-5-5:streamRawPredict" -H "x-goog-api-key: $KEY" -d '{"anthropic_version":"vertex-2023-10-16","messages":[],"max_tokens":64}'`,
    ),
  ).toEqual({
    format: 'anthropic',
    keyHeader: 'x-goog-api-key',
    model: 'claude-sonnet-5-5',
    endpoint:
      'https://gw.example.com/api/google/v1/publishers/anthropic/models/claude-sonnet-5-5:rawPredict',
  })
  // Google's own address takes hour-long sign-in tokens, not a key.
  expect(
    parseAiExample(
      `curl https://europe-west1-aiplatform.googleapis.com/v1/projects/p/locations/europe-west1/publishers/anthropic/models/claude-sonnet-5-5:rawPredict -H "Authorization: Bearer $(gcloud auth print-access-token)"`,
    ),
  ).toMatchObject({ unsupported: 'Google Vertex AI' })
})
