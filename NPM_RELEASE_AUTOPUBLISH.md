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
npm view @yashgupta18/devmonitor version
```

5. Push commit and tag:

```bash
git push
git push --tags
```

## Auto-Publish Workflow

The workflow file is:
- `.github/workflows/publish-npm.yml`

Behavior:
- Triggers on pushes to `main`
- Runs install and tests
- Reads package name and version from `package.json`
- Checks whether that exact version already exists on npm
- Publishes only when the version does not already exist
- Uses GitHub OIDC Trusted Publishing (no npm token secret)
- Uses GitHub Actions environment: `npm-publish`

## One-Time Setup

1. Configure Trusted Publisher in npm:
- npm package settings -> Trusted Publishers -> Add Publisher
- Provider: GitHub Actions
- Repository: `yashgupta18/devmonitor`
- Workflow file: `.github/workflows/publish-npm.yml`
- Environment name: `npm-publish`
- Allowed actions: select `allow npm publish`
- Optional: select `allow npm stage publish` only if you plan staged releases

2. Create GitHub environment:
- GitHub repo -> Settings -> Environments -> New environment
- Name: `npm-publish`
- Optional: add required reviewers if you want approval before publish

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
- Version already exists:
  - Bump version and push again
- Workflow skipped publish:
  - Confirm `package.json` version differs from npm registry
