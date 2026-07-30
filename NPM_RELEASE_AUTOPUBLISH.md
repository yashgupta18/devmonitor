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

## One-Time Setup

1. Create an npm token:
- npm website -> Access Tokens
- Create a granular token with package publish permissions
- If your npm account enforces 2FA for publish, use a token that can bypass 2FA for automation

2. Add repository secret in GitHub:
- Secret name: `NPM_TOKEN`
- Secret value: your npm token

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
  - Check `NPM_TOKEN` permissions
  - Regenerate token with proper publish scope
- Version already exists:
  - Bump version and push again
- Workflow skipped publish:
  - Confirm `package.json` version differs from npm registry
