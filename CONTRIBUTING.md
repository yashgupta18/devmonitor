# Contributing to Devtracekit

Thanks for contributing.

## Development Setup

1. Install dependencies:

```bash
npm install
```

2. Run tests:

```bash
npm test
```

3. Start local example:

```bash
npm run devtracekit:start -- --example
```

## Pull Request Guidelines

- Keep PRs focused and small.
- Add or update tests for behavior changes.
- Update docs when user-visible behavior changes.
- Prefer backward-compatible API updates unless major versioning is planned.
- PR titles must start with an approved type tag.

### Required PR Title Tags

Use one of the following PR title formats:

- `feat: short summary`
- `fix: short summary`
- `perf: short summary`
- `docs: short summary`
- `refactor: short summary`
- `test: short summary`
- `chore: short summary`
- `build: short summary`
- `ci: short summary`
- `feat!: short summary` (breaking change)

If a PR includes a breaking change, include `BREAKING CHANGE:` in the PR body with migration details.

### Changelog Mapping

| Commit type                    | Section in changelog     |
| ------------------------------ | ------------------------ |
| `feat:`                        | Features                 |
| `fix:`                         | Bug Fixes                |
| `perf:`                        | Performance Improvements |
| `docs:`                        | Documentation            |
| `refactor:`                    | Code Refactoring         |
| `test:`                        | Tests                    |
| `chore:`, `build:`, `ci:`      | (omitted from changelog) |
| `feat!:` or `BREAKING CHANGE:` | ⚠ BREAKING CHANGES       |

## Commit Style

Use clear commit messages. Conventional commits are recommended:

- `feat: ...`
- `fix: ...`
- `docs: ...`
- `test: ...`
- `chore: ...`

## Reporting Issues

When filing a bug, include:

- Steps to reproduce
- Expected behavior
- Actual behavior
- Logs or screenshots
- Environment (OS, Node version)

## Security

Do not open public issues for sensitive vulnerabilities.
Contact maintainers privately for responsible disclosure.
