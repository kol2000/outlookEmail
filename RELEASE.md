# Release Guide

This project uses a lightweight release workflow based on two long-lived branches and semantic version tags.

## Branches

- `main`: stable, releasable code only
- `dev`: day-to-day development branch

## Versioning

This project follows Semantic Versioning:

- `PATCH` (`1.0.1`): bug fixes and backward-compatible maintenance
- `MINOR` (`1.1.0`): backward-compatible features
- `MAJOR` (`2.0.0`): breaking changes

## Release Checklist

### 1. Finish work on `dev`

```bash
git checkout dev
git pull origin dev
# make changes
git add .
git commit -m "feat: describe your change"
git push origin dev
```

### 2. Merge `dev` into `main`

```bash
git checkout main
git pull origin main
git merge --no-ff dev
```

### 3. Update release metadata

Update `VERSION` to the new version number, for example:

```txt
1.0.1
```

Add a new entry to `CHANGELOG.md`.

Example:

```md
## [1.0.1] - 2026-04-07

### Fixed
- Describe the fix
```

Commit the release metadata:

```bash
git add VERSION CHANGELOG.md
git commit -m "chore: release v1.0.1"
```

### 4. Push `main`

```bash
git push origin main
```

### 5. Create and push the tag

```bash
git tag -a v1.0.1 -m "Release v1.0.1"
git push origin v1.0.1
```

### 6. Trigger the GitHub Release workflow manually

The repository now creates GitHub Releases through the `Create GitHub Release`
workflow (`.github/workflows/release.yml`) via `workflow_dispatch`.

Trigger it from GitHub Actions and provide the version number without the `v`
prefix, for example:

```txt
1.0.1
```

This workflow will:

- create and push tag `vX.Y.Z`
- publish the matching Docker image `ghcr.io/assast/outlookemail:vX.Y.Z`
- build the Windows executable package
- create the GitHub Release using the matching `CHANGELOG.md` section when available

## Docker image tags

The GitHub Actions workflow publishes these image tags:

- `ghcr.io/assast/outlookemail:latest` → stable default branch build
- `ghcr.io/assast/outlookemail:main` → latest `main`
- `ghcr.io/assast/outlookemail:dev` → latest `dev`
- `ghcr.io/assast/outlookemail:vX.Y.Z` → tagged release image

## Windows executable

When you manually trigger the release workflow, GitHub Actions builds a Windows
`exe` with PyInstaller and attaches `OutlookEmail-windows-x64-vX.Y.Z.zip` to the
GitHub Release.

## GitHub Release

GitHub Release creation is manual through the `Create GitHub Release` workflow.
The workflow uses the matching section from `CHANGELOG.md` when available and
uploads the Windows package as a release asset.
