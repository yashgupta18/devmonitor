# npm Release and Auto-Publish

This guide covers:
- Manual npm release steps
- Automatic npm publish on pushes to `main` when `package.json` version changes

## Manual Release

1. Bump version:

```bash
npm version patch
```

Use `minor` or `major` if needed.

2. Validate package and tests:

```bash
npm pack --dry-run
npm test
```

3. Publish:

```bash
npm publish --access public
```

4. Verify published version:

```bash
npm view devtracekit version
```

5. Push commit and tag:

```bash
git push
git push --tags
```

## Auto-Publish Workflow

The workflow file is:
- `.github/workflows/publish.yml`

Behavior:
- Triggers on pushes to `main`
- Runs install and tests
- Reads package name and version from `package.json`
- Checks whether that exact version already exists on npm
- Publishes only when the version does not already exist
- Publishes with GitHub OIDC Trusted Publishing first
- Falls back to `NPM_TOKEN` secret when Trusted Publishing fails
- Uses GitHub Actions environment: `npm-publish`

## One-Time Setup

1. Configure Trusted Publisher in npm:
- npm package settings -> Trusted Publishers -> Add Publisher
- Provider: GitHub Actions
- Repository: `yashgupta18/devtracekit`
- Workflow file: `.github/workflows/publish.yml`
- Environment name: `npm-publish`
- Allowed actions: select `allow npm publish`
- Optional: select `allow npm stage publish` only if you plan staged releases

2. Create GitHub environment:
- GitHub repo -> Settings -> Environments -> New environment
- Name: `npm-publish`
- Optional: add required reviewers if you want approval before publish

3. Optional fallback secret (recommended):
- GitHub repo -> Settings -> Secrets and variables -> Actions -> New repository secret
- Name: `NPM_TOKEN`
- Value: npm automation token with publish rights to `devtracekit`

3. Ensure the package version changes before merging to `main`:
- If version is unchanged, workflow will skip publish

## Recommended Release Flow with Automation

1. In your feature/release PR:
- Update code
- Bump `package.json` version

2. Merge PR to `main`:
- CI runs
- npm publish workflow runs
- New version is published automatically if not already on npm

## Troubleshooting

- `E403` permission or 2FA errors:
  - Confirm Trusted Publisher is linked to the exact repo/workflow/environment
  - Confirm workflow has `id-token: write` permission
- `E404` on package publish from Actions:
  - Confirm Trusted Publisher is configured on the package `devtracekit` (not only account-level)
  - Confirm repository is exactly `yashgupta18/devtracekit` after repo rename
  - Confirm workflow file is exactly `.github/workflows/publish.yml`
  - Confirm environment name is exactly `npm-publish`
  - Remove and re-add the Trusted Publisher entry after repo rename
  - Re-run workflow and compare debug step values with npm Trusted Publisher fields
  - If Trusted Publisher still fails, set `NPM_TOKEN` so fallback publish succeeds automatically
- Version already exists:
  - Bump version and push again
- Workflow skipped publish:
  - Confirm `package.json` version differs from npm registry
