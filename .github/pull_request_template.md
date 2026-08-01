## Summary

Describe what this PR changes.

## Required PR Title Format

Use one of these prefixes in the PR title:

- `feat: ...`
- `fix: ...`
- `perf: ...`
- `docs: ...`
- `refactor: ...`
- `test: ...`
- `chore: ...`
- `build: ...`
- `ci: ...`
- `feat!: ...` for breaking changes

If this PR introduces a breaking change, include `BREAKING CHANGE:` in the PR description.

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

## Type of Change

- [ ] Feature
- [ ] Bug fix
- [ ] Refactor
- [ ] Docs
- [ ] Tests

## Validation

- [ ] `npm test` passes locally
- [ ] Manual verification completed (if applicable)

## Checklist

- [ ] Tests added/updated as needed
- [ ] Docs updated as needed
- [ ] No unrelated changes included
- [ ] PR title uses an approved prefix (for example, `feat: add SLO export endpoint`)
- [ ] Breaking changes are marked with `feat!:` and `BREAKING CHANGE:` in the description
