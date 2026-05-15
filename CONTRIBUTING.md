# Contributing

Local setup, test recipes, and release steps for `@simplyprint/n8n-nodes-simplyprint`.

## Prerequisites

- **Node.js** `>= 20.15` (see `engines.node` in `package.json`).
- **npm** (this package ships via `npm publish`; the pinned lockfile is npm-flavoured).
- A SimplyPrint test account and an OAuth2 credential or API key for running the node end-to-end.

## Local development

```bash
npm ci
npm run build          # `n8n-node build` — runs tsc and copies icons / codex files to dist/
npm run lint           # `n8n-node lint` — eslint flat config from @n8n/node-cli (strict mode)
npm run lint:fix       # auto-fix the fixable subset
npm run test           # vitest unit tests
npm run dev            # `n8n-node dev` — boots a local n8n with this package symlinked in
npm run build:watch    # tsc --watch (use this for fast incremental TS rebuilds)
```

### Load the node into a local n8n

The recommended path is `npm run dev`, which symlinks this package into `~/.n8n/custom` and starts n8n for you. If you'd rather wire it up by hand:

1. `cd ~/.n8n/custom && npm link /path/to/this/repo` (or `npm link` globally, then `npm link @simplyprint/n8n-nodes-simplyprint` inside `~/.n8n/custom`).
2. Start n8n with `N8N_COMMUNITY_PACKAGES_ENABLED=true`.
3. After any change, run `npm run build` in this repo — n8n picks up the new `dist/` on its next hot reload / restart.

### Scan before submitting for verification

n8n recommends running the official scanner before submitting the package for verification. It runs the same lint suite the verifier uses plus a few package-structure checks:

```bash
npx @n8n/scan-community-package @simplyprint/n8n-nodes-simplyprint
```

## Code conventions

- **UI copy**: Title Case for node names, display names, and dropdown titles. Sentence case for action names, descriptions, hints, and placeholders. No trailing periods on short descriptions. Boolean descriptions start with `Whether ...`. Placeholders start with `e.g. ...`.
- **Operations**: follow n8n CRUD vocabulary — `Create`, `Get`, `Get Many`, `Update`, `Delete`, `Create or Update` (upsert). Internal operation values use camelCase (`getAll`, `setValues`).
- **Single-item selects**: use `type: 'resourceLocator'` with `list` and `id` modes. Register a `searchXxx` helper in `nodes/SimplyPrint/common/dropdowns.ts` and wire it under `methods.listSearch` on the node.
- **Delete operations**: always return `{ deleted: true }`.
- **Get Many with >10 fields**: expose a `simplify` boolean and implement a simplifier in `nodes/SimplyPrint/common/simplify.ts` that keeps at most ten useful fields.

See `.ai/` (SimplyPrint's internal developer guide) for the full SimplyPrint-side conventions.

## Testing

Unit tests live in `tests/` and run under Vitest. Cover:

- Pure utilities (`signature.ts`, `customFields.ts`, `startOptions.ts`, `simplify.ts`).
- Webhook lifecycle (`checkExists` / `create` / `delete`) against mocked `IHookFunctions`.
- At least one happy-path `execute()` per resource.

Always run `npm run lint` and `npm test` before a PR.

## Release

Releases are fully automated via GitHub Actions and npm Trusted Publishing (OIDC). There is no long-lived `NPM_TOKEN` in the repo.

1. On `main`, bump the version in `package.json` (semver — `0.x` is pre-1.0, breaking changes can land in minor bumps but must be documented under `### Breaking changes` in the CHANGELOG).
2. Move the `## Unreleased` section of `CHANGELOG.md` under the new version header, then start a fresh `## Unreleased` section for work in progress.
3. Commit and push: `git commit -am "Release vX.Y.Z" && git push origin main`.
4. Tag the commit and push the tag: `git tag vX.Y.Z && git push origin vX.Y.Z`.
5. The `.github/workflows/release.yml` workflow fires on `v*.*.*` tags. It runs `npm run release`, which delegates to `n8n-node release`; in CI mode that command runs lint + build and then `npm publish` with provenance enabled. Check the npm page afterwards for the "Built and signed on GitHub Actions" badge.
6. A GitHub Release is auto-generated with `softprops/action-gh-release` and the `.tgz` attached.

`npm publish` is intentionally guarded: the `prepublishOnly` hook runs `n8n-node prerelease`, which refuses to proceed unless `RELEASE_MODE=true` is set (the `release` command sets it). This prevents accidentally publishing without provenance from a developer machine.

### Re-running a failed release

If a step fails mid-publish (e.g. lint), fix on `main`, delete the tag locally and on the remote (`git tag -d vX.Y.Z && git push origin :refs/tags/vX.Y.Z`), then re-tag and push. Do not amend a tag that npm already accepted; create a new patch version instead.

## Submitting for n8n verification

- Ensure the scan passes: `npx @n8n/scan-community-package @simplyprint/n8n-nodes-simplyprint`.
- Ensure the latest npm release was published from the GitHub Actions workflow with provenance (required after May 1, 2026).
- Apply through the [n8n Creator Portal](https://creators.n8n.io) with a pointer to the npm page and this repository.
