# Steerloom repository instructions

## Product

- Steerloom is a delivery-flow workspace for team leads. Users connect Jira
  Cloud, Jira Data Center or Trello, select boards, choose metrics, and use
  saved dashboards with a read-only analysis agent.
- Two ways to run it, sharing the same browser app and analytics:
  - **Local**: Vite dev server on loopback (`server/workspace`, `server/jira`,
    `server/ai`); accounts and encrypted credentials in `.flowlens/`.
  - **Hosted**: production Node server (`server/hosted`) with Supabase
    accounts/workspaces, deployed on Render behind Cloudflare at
    `https://steerloom.app`.
- The platform is provider- and company-neutral. Every user connects their own
  boards from the UI; never add machine-wide credential discovery, internal
  company hosts, instances, project keys or tooling to code, docs or defaults.
  `scripts/package-local.mjs` fails the public local package on such references.
- Legacy `FLOWLENS_*` environment variables and `.flowlens/` paths are kept for
  compatibility; new settings use `STEERLOOM_*`.

## Guardrails

- Provider access is read-only. Never add Jira or Trello write operations or
  write scopes. Allowlist requested and returned fields.
- Tokens, API keys, OAuth secrets and session secrets stay server-side: never in
  browser code, URLs, logs, JSON responses or `VITE_`-prefixed variables.
- All flow calculations run in the browser. Never persist or log imported board
  rows, provider responses or chat conversations.
- The hosted server must keep membership checks on every workspace read,
  mutation, provider callback and token refresh. It runs as exactly one
  instance (disk-backed sessions).
- Do not add telemetry or analytics, a new data store, or new third-party
  services without explicit user approval.
- Never use real company data in tests, fixtures, examples or screenshots; use
  fictional values and `*.example.invalid` hosts.

## Code conventions

- Use strict TypeScript and avoid `any`.
- Keep CSV, column-matching, statistics and provider normalisation outside React
  components, deterministic and covered by domain tests.
- Explain metrics with transparent rule-based text; never score individuals.
- Use accessible labels, keyboard-operable controls, visible focus states,
  semantic headings and sufficient contrast. Support 320 px widths upwards.
- Edit existing CSS rules instead of appending overrides; reuse tokens from
  `src/styles/tokens.css` and primitives from `src/components/ui`.
- Update `README.md` or `docs/` whenever user-visible behaviour or
  data-handling assumptions change.

## Before finishing a change

CI runs these on every push and pull request; run and fix them locally:

```bash
npm run lint
npm run format:check
npm test
npm run build:hosted
```

Add or update domain-level tests for statistics, provider normalisation and
server authorization changes. Avoid tests that only assert that a component
renders.
