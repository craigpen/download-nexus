# Changelog Workflow

This document explains how to generate and review the changelog before publishing a release.

## Quick Start

1. **Generate changelog** → Actions → "Generate Changelog" → Enter version (e.g. `1.2.0`) → Run workflow
2. **Review changes** in the commit or PR
3. **Merge** if it looks good (if created as PR)
4. **Tag is created automatically** with version
5. **Publish** → Actions → "Publish to App Stores"

---

## How It Works

The changelog is automatically generated from your **conventional commits** using the [Angular preset](https://github.com/conventional-changelog/conventional-changelog/tree/master/packages/conventional-changelog-angular).

### Commit Format

For changes to appear in the changelog, use conventional commit messages:

```
feat: add new feature               → Added section
fix: resolve a bug                  → Fixed section
refactor: restructure code          → (internal, not shown)
docs: update documentation          → (internal, not shown)
feat!: breaking change              → Removed/Breaking Changes section
```

### Examples

- `feat: add JDownloader 2 support` → Shows in **Added**
- `fix: resolve aria2 import error` → Shows in **Fixed**
- `feat!: remove Aria2 adapter` → Shows in **BREAKING CHANGES**

---

## Generating Changelog

### Option 1: Via GitHub Actions (Recommended)

1. Go to **Actions** tab
2. Select **"Generate Changelog"**
3. Click **"Run workflow"**
4. Enter:
   - **Version**: Release version (e.g., `1.2.0`, `2.0.1`)
   - **Create PR** (optional): Opens a PR for review first
   - **Create tag** (optional): Automatically creates git tag (default: true)
5. Run workflow

**Result:**
- If PR mode: Creates PR with changelog changes
- If direct commit: Commits to main and creates version tag (e.g., `v1.2.0`)

### Option 2: Locally

```bash
npm run changelog
```

Then review `CHANGELOG.md`, commit, and push:

```bash
git add CHANGELOG.md
git commit -m "chore: update changelog"
git push
```

---

## Reviewing the Changelog

The generated changelog shows:

- **Added** — New features
- **Fixed** — Bug fixes
- **Changed** — Non-breaking updates
- **BREAKING CHANGES** — Breaking changes and removals (when using `feat!:`)

### Example Entry

```markdown
### Added
- Full multi-service support for qBittorrent, Transmission, Deluge

### Fixed
- Resolved chrome.runtime undefined errors in content scripts

### BREAKING CHANGES
- Aria2 adapter has been removed
```

---

## Release Workflow

### Step 1: Generate Changelog
1. Ensure all commits use **conventional commit format** (feat:, fix:, etc.)
2. Go to **Actions → Generate Changelog**
3. Enter the **version** (e.g., `1.2.0`)
4. Choose:
   - **Create PR**: For manual review before tagging
   - **Create tag**: Automatically creates `v1.2.0` tag after commit

### Step 2: Review (if using PR mode)
1. Review the generated changelog in the PR
2. Make manual edits if descriptions need fixes
3. Merge the PR
4. Run the workflow again with **create_pr: false** and **create_tag: true** to create the tag

### Step 3: Publish
1. Go to **Actions → Publish to App Stores**
2. Choose which store(s) to publish to
3. The version tag will be included in the release

---

## Common Issues

### Changelog is empty or incomplete

- **Cause**: Commits don't follow conventional commit format
- **Fix**: Check recent commits with `git log --oneline` and ensure they start with `feat:`, `fix:`, `refactor:`, etc.

### Changelog includes commits we don't want

- **Cause**: Commits from older versions still in history
- **Fix**: Use the `--lerna-skip` flag or manually edit `CHANGELOG.md` before publishing

### Want to regenerate from scratch?

```bash
npm run changelog:init
```

This creates a fresh CHANGELOG.md with all historical commits.

---

## Version Management

### Keeping Everything in Sync

The version appears in three places, but is automatically synchronized:

| Source | Purpose | How It Updates |
|--------|---------|---|
| `package.json` | Source of truth | Manual edit (only place you update) |
| `manifest.json` | Extension version | Auto-synced by `npm run build` |
| Popup backup export | Backup file metadata | Reads from `manifest.json` at runtime |

### Before Release

1. **Bump version in package.json**:
   ```bash
   # Edit package.json and update "version": "1.2.3"
   ```
2. **Build** (auto-syncs manifest):
   ```bash
   npm run build:all  # Updates dist/*/manifest.json from package.json
   ```
3. **Commit version bump**:
   ```bash
   git add package.json manifest.json src/popup.js
   git commit -m "chore: bump version to 1.2.3"
   ```
4. **Generate changelog** with that version
5. **Publish**

## Integration with Publishing

The publish workflow **does not** generate the changelog automatically. You must:

1. Generate and review changelog **before** publishing
2. This ensures you control what goes into the release notes
3. Changes to CHANGELOG.md will be included in the version tag
4. Version in CHANGELOG matches the git tag

---

## References

- [Conventional Commits](https://www.conventionalcommits.org/)
- [Angular Commit Format](https://github.com/angular/angular/blob/master/CONTRIBUTING.md#commit)
- [conventional-changelog](https://github.com/conventional-changelog/conventional-changelog)
