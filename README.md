# DevScope

DevScope is a local-first observability toolkit for backend development.

It lets you run a sample service and immediately inspect:
- Request traces
- Downstream SQL/Redis/Kafka/job events
- Service dependency graph
- Local connector status (Docker, Kubernetes, ECS, Nomad)
- AI-style rule-based insights
- GitHub incident intelligence (heuristic commit correlation)

## Current Status

- MVP and roadmap tasks in `TASKS.md` are complete.
- Automated tests are passing.
- The project is suitable for a public alpha release.

## Requirements

- Node.js 18+
- npm 9+
- Optional tools for connector panels:
  - Docker CLI and daemon
  - kubectl and configured context
  - AWS CLI (for ECS)
  - Nomad CLI

## Quick Start

1. Install dependencies:

```bash
npm install
```

2. Run tests:

```bash
npm test
```

3. Start DevScope with the example app:

```bash
npm run devscope:start -- --example
```

4. Open:

- Dashboard: http://localhost:4318
- Example API: http://localhost:3000

5. Generate traffic:

```bash
curl http://localhost:3000/checkout
curl "http://localhost:3000/load?requests=10"
curl http://localhost:3000/otel-checkout
```

## If Port 4318 Is Busy

Run on alternate ports:

```bash
DEVSCOPE_DASHBOARD_PORT=4328 DEVSCOPE_APP_PORT=3010 npm run devscope:start -- --example
```

Then open:
- Dashboard: http://localhost:4328
- Example API: http://localhost:3010

## Python Example

1. Create a virtualenv:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -e ./packages/devscope-python
```

2. Point Python client to DevScope ingest endpoint:

```bash
export DEVSCOPE_INGEST_URL=http://localhost:4328/api/ingest/otel
python ./examples/python-otel-example.py
```

## Dashboard Features

- Live traces with endpoint/status/method filters
- Trace timeline details
- Service dependency graph
- Connector health panels
- AI Explanations panel (`GET /api/insights`)
- GitHub Incident Intelligence panel (`POST /api/intelligence/github`)

## API Endpoints

- `GET /healthz`
- `GET /api/traces`
- `GET /api/traces/:traceId`
- `POST /api/ingest/otel`
- `GET /api/graph`
- `GET /api/insights`
- `POST /api/intelligence/github`
- `GET /api/connectors/docker`
- `GET /api/connectors/kubernetes`
- `GET /api/connectors/ecs`
- `GET /api/connectors/nomad`

## CLI

Start DevScope:

```bash
npm run devscope:start
```

Start DevScope plus sample app:

```bash
npm run devscope:start -- --example
```

## Open-Source Release Checklist (Suggested)

Before publishing publicly:
- Add `LICENSE` file (MIT text).
- Add `CONTRIBUTING.md`.
- Add issue and PR templates.
- Add CI workflow for `npm test`.
- Add release notes for `v0.1.0-alpha`.

## NPM Publishing Guidance

You do not need to publish to npm to open source the repository.

Recommended approach:
1. Open source the GitHub repo first.
2. Gather feedback on DX and stability.
3. Publish npm packages after API/contracts settle.

Current packaging note:
- `npm pack --dry-run` for the root package includes many repo files (docs/tests/examples and Python package source).
- If you publish, refine package contents first via `files` in `package.json` or `.npmignore`.

## Project Docs

- Plan: `DEVSCOPE_MVP_PLAN.md`
- Task tracker: `TASKS.md`
- Test/validation guide: `TESTING.md`
