# Release Notes

This document is used to describe the standard release process, version number rules, GitHub Actions behavior, and post-release verification steps of this warehouse.

## Scope of application

- Daily development branch: `dev`
- Stable release branch: `main`
- Version label automatically released: `git push origin vX.Y.Z`
- Manual publishing workflow: `Create GitHub Release`

## Version number rules

The project adopts semantic version number:

- `MAJOR.MINOR.PATCH`
- Example: `2.0.15`

Agreement:

- Pushing a Git tag in the shape of `v2.0.16` will automatically trigger the release workflow
- When manually publishing GitHub Actions, enter the version number without `v`, such as `2.0.15`
- The workflow will automatically create the corresponding label `v2.0.15`
- The version title in `CHANGELOG.md` must also be written as `## [2.0.15] - 2026-04-15`

## Released products

After pushing the version tag or manually triggering the `Create GitHub Release` workflow, the following products will be automatically generated:

- Git tag: `vX.Y.Z`
- GitHub Release: Titled `vX.Y.Z`
- Windows desktop compressed package: `OutlookEmail-windows-x64-X.Y.Z.zip`
- macOS installation package: `OutlookEmail-macos-x64-X.Y.Z.dmg`, `OutlookEmail-macos-arm64-X.Y.Z.dmg`
- Docker image: `ghcr.io/assast/outlookemail:vX.Y.Z`

Additional explanation:

- `latest` / `main` / `dev` tags come from Docker workflow triggered by branch push
- Release workflow is responsible for releasing version image `vX.Y.Z`
- The GitHub Release text first extracts the corresponding version entries from `CHANGELOG.md`

## Pre-release inspection

It is recommended to confirm item by item before publishing:

1. The target commit has been merged into `main`, and `main` is in a releasable state.
2. `VERSION` has been updated to this version number.
3. `CHANGELOG.md` has added an entry for this version, with complete date and content.
4. If you need to remind users of new features, the copy of `releaseNoticeModal` in `templates/partials/index/dialogs-management.html` has been updated.
5. The behavior descriptions involved in `README.md`, deployment documents, and upgrade documents do not conflict with the current implementation.
6. If this change affects Docker, Windows `exe`, environment variables, API or front-end interaction, the document has been written synchronously.

## Standard release steps

### 1. Complete function development and verification in `dev`

It is recommended to complete functions, fixes and document organization in the `dev` branch first, and then merge it into `main`.

### 2. Merged into `main`

Ensure that the commit on `main` is the final code ready for release.

### 3. Update version number

Synchronously update the following content:

- `VERSION`
- `CHANGELOG.md`
- `releaseNoticeModal` copywriting in `templates/partials/index/dialogs-management.html` (if you need to prompt users for new features)

Example:

```txt
VERSION            -> 2.0.15
CHANGELOG.md title -> ## [2.0.15] - 2026-04-15
```

### 4. Submit and push `main`

```bash
git checkout main
git pull
git add VERSION CHANGELOG.md README.md RELEASE.md docs/
git commit -m "docs: prepare release 2.0.15"
git push origin main
```

If this release also contains code changes, please submit the code files together.

### 5. Push version tag to trigger automatic release

```bash
git tag -a v2.0.16 -m "Release v2.0.16"
git push origin v2.0.16
```

After pushing, the `Create GitHub Release` workflow will automatically run and publish the version.

### 6. Manually trigger the GitHub Release workflow (informal)

If you don’t want to trigger it by pushing a tag, or you need to reissue a certain version, you can also enter GitHub Actions and run it manually:

- Workflow name: `Create GitHub Release`
- Input parameters: `version`
- Input example: `2.0.15`

Do not fill in `v2.0.15`, otherwise an error label will be generated.

## The actual execution content of the workflow

The `Create GitHub Release` workflow will execute the following stages in sequence:

### 1. Build Windows `exe`

- Use `pyinstaller --noconfirm --clean outlookEmail.spec`
- Package `dist/OutlookEmail.exe`
- Compressed with `README.md` as release attachment

### 2. Build macOS DMG

- Running `scripts/build-macos-dmg.sh` on macOS x64 and arm64 Runner
- Use PyInstaller to generate `OutlookEmail.app`
- Use `hdiutil` to generate DMG publishing attachments that can be dragged and installed

### 3. Create and push tags

- `vX.Y.Z` will be automatically created when triggered manually
- When tag push is triggered, the currently pushed `vX.Y.Z` will be directly reused.
- If the tag with the same name already exists and points to the current submission, the creation will be skipped
- If a tag with the same name exists but points to another commit, the workflow will fail and stop publishing.

### 4. Generate Release Notes

The workflow will extract the content corresponding to the current version from `CHANGELOG.md`:

- Matching format: `## [X.Y.Z]`
- If no match is found, it will fall back to a very short default description.

Therefore, before the official release, you should ensure that `CHANGELOG.md` has written the entry for this version in advance.

### 5. Build and push the Docker version image

The workflow calls `docker-build-push.yml` and is built based on the tag `refs/tags/vX.Y.Z`:

- `ghcr.io/assast/outlookemail:vX.Y.Z`

### 6. Release GitHub Release

The official Release will eventually be created and the Windows compressed package and macOS DMG attachment will be uploaded.

## Check after release

It is recommended to check at least the following items:

1. The GitHub Release page has been generated with the correct title and body.
2. The Release attachment can be downloaded, and the file name contains the version number.
3. `vX.Y.Z` exists in the warehouse tab.
4. Pullable version images in GHCR:

```bash
docker pull ghcr.io/assast/outlookemail:v2.0.15
```

5. If this version contains deployment or interface changes, sample a test environment to verify that the upgrade is successful.

## FAQ

### Why is the GitHub Release text incomplete?

Usually the corresponding version title is not written in `CHANGELOG.md`, or the title format does not match. Example of correct format:

```md
## [2.0.15] - 2026-04-15
```

### Why does the workflow prompt label already exist but the SHA is inconsistent?

Indicates that the tag with the same name has been applied to other submissions. At this time, do not continue to force the release. You should first confirm:

- Are duplicate version numbers used this time?
- `main` Whether additional commits have occurred
- Whether historical tags have been created incorrectly

### Why is the `latest` image not refreshed?

Because the Release workflow only releases the `vX.Y.Z` image. `latest` / `main` / `dev` come from the Docker workflow triggered by branch push, not the Release workflow.

## Recommended release cadence

1. Usually develop and repair in `dev`.
2. Merged into `main` when ready for release.
3. First complete `CHANGELOG.md` and related documents, and then push the `vX.Y.Z` tag to trigger automatic release.
4. After release, use the `vX.Y.Z` image to do an actual deployment verification.
