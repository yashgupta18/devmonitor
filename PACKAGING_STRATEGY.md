# Packaging Strategy

## Decision

Use a multi-package strategy.

## Rationale

The repository contains distinct deliverables:

1. Root package `devtracekit`:
- Local CLI and dashboard runtime.

2. Node SDK package `@devtracekit/sdk`:
- Integration surface for instrumented Node apps.

3. Python package `devtracekit`:
- Python client/SDK in `packages/devtracekit-python`.

Keeping these as separate publishable artifacts allows teams to adopt only what they need.

## Immediate Publishing Plan

1. Keep the root package publishable for CLI use.
2. Restrict root published contents to runtime assets only.
3. Publish `@devtracekit/sdk` independently when versioning and release notes are ready.
4. Publish Python package from `packages/devtracekit-python` to PyPI separately.

## Follow-ups

- Add release automation for npm and PyPI.
- Align semantic versioning across packages where needed.
- Add changelog generation per package.
