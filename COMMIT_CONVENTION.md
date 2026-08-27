# Commit Message Convention

This project uses [Conventional Commits](https://www.conventionalcommits.org/) to enable automated changelog generation.

## Commit Message Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Type

Must be one of the following:

- **feat**: A new feature
- **fix**: A bug fix
- **docs**: Documentation only changes
- **style**: Changes that do not affect the meaning of the code (white-space, formatting, missing semi-colons, etc)
- **refactor**: A code change that neither fixes a bug nor adds a feature
- **perf**: A code change that improves performance
- **test**: Adding missing tests or correcting existing tests
- **chore**: Changes to build process, dependencies, or development tools

### Scope

Optional. Specifies the component affected:
- `qbit`, `transmission`, `deluge`, `synology` - for adapter changes
- `ui`, `popup`, `button` - for UI changes
- `auth` - for authentication changes
- etc.

### Subject

- Use imperative mood: "add" not "added" or "adds"
- Don't capitalize first letter
- No period (.) at the end
- Limit to 50 characters

### Body

Optional. Explain what and why, not how. Wrap at 72 characters.

### Footer

Optional. Reference issues: `Fixes #123`

## Examples

```
feat(qbit): add password change detection for Deluge

Detect when Deluge is prompting for password change and 
show user-friendly error message.

Fixes #42
```

```
fix(button): resolve popup menu click handling

The popup menu options were not clickable because pointer-events
was not properly set. Added explicit pointer-events: auto to both
the popup container and menu options.
```

```
docs: update README for all supported services
```

## Generating Changelog

To generate changelog entries since the last release:

```bash
npm run changelog
```

This will prepend generated entries to CHANGELOG.md.

To initialize CHANGELOG.md from all commits:

```bash
npm run changelog:init
```

## Automated Release Notes

When a release is created on GitHub, the workflow automatically:
1. Generates changelog from commits since last tag
2. Uses it in the release notes
3. Updates CHANGELOG.md
