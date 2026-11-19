# Updating this fork

The original upstream history is preserved. The shared base for the current localization is upstream v3.0.9 (`d7a00986deb2e55f286e28b74e528c880cf98f42`). Keep upstream commit messages unchanged; English translations belong in new commits, not rewrites of upstream history.

## GitHub Sync fork

Open the repository's `main` branch and choose **Sync fork**. When GitHub offers **Update branch** without conflicts, it can merge the upstream changes. If conflicts are reported, stop and resolve them in an update branch. **Discard commits** replaces the fork's changes and is not a localization-preserving update.

Syncing only updates source code. New interface strings still need English/Russian translations, and a Windows release must be built and published separately after verification. Existing installed copies do not change just because a branch was synchronized.

## Update branch workflow

Start from a clean checkout of this fork. If the `upstream` remote is not configured, add it once:

```sh
git remote add upstream https://github.com/assast/outlookEmail.git
```

For an update to a chosen release, fetch its tag and merge it into a new branch, for example:

```sh
git fetch origin
git fetch upstream tag v3.0.32
git switch -c update/upstream-v3.0.32 origin/main
git merge --no-commit --no-ff v3.0.32
```

Resolve conflicts while preserving upstream behavior and both locale catalogs. Add translations for new strings. Run the regression suite, the locale validator, and both-language UI checks before committing and opening a pull request. After merging, build the Windows package from the tested commit and publish a new versioned release.

## Current status

The restored branches still contain the v3.0.9-based application. A non-mutating trial merge against upstream v3.0.32 found conflicts; that upgrade has not been applied. The existing release tag and Windows ZIP retain the same application source tree and binary contents.

Restoring shared history changed fork commit IDs once. For an older local clone, preserve local work and preferably make a fresh clone. Do not merge the earlier rewritten history back into the restored branch.
