# Security

## Security Features Overview

PromptGraph implements defense-in-depth across multiple layers: input validation, path traversal protection, download limits, rate limiting, content scanning, and a trust system for the marketplace.

## Path Traversal Protection

Every file path is resolved through `path.resolve()` before use. `..` sequences are blocked at multiple points:

- **config.js** `sanitizePath()` — throws if input path contains `..`
- **api.js** `index()` — checks `sourceDir.includes('..')`
- **indexer.js** `sanitizePath()` — resolves via `path.resolve()`
- **validator.js** — checks if any path segment is exactly `..`
- **marketplace.js** — validates destination starts with expected directory after `path.resolve()`

All marketplace installations (`installSkillFromUrl`, `installSkill`, `installBundle`) verify `path.resolve(dest).startsWith(path.resolve(SKILLS_DIR))`.

## Download Limits

| Limit | Value | Enforcement |
|-------|-------|-------------|
| Per-file download | 50 MB | `streamDownload()` checks Content-Length and streaming byte count |
| Per-file storage | 5 MB | `indexFile()` and `indexAll()` stat before reading |
| Files per repo | 100,000 | `indexAll()` counter + truncation |
| Total repo size | 500 MB | `github-import.js` accumulates byte count |
| Embedding calls | 10,000 per session | `embedder.js` throws when exceeded |

## Rate Limiting

Two independent rate limiters (`src/utils/rate-limiter.js`) protect GitHub API calls:

| Limiter | Requests | Window | Used By |
|---------|----------|--------|---------|
| GitHub API | 30 | 60 seconds | `httpsGet()` for API calls |
| Download | 60 | 60 seconds | `streamDownload()` for raw file downloads |

The `RateLimiter` uses a sliding-window algorithm with automatic back-pressure: `acquire()` blocks until a slot is available.

## Input Validation

### Skill Validation (`validator.js`)

Every skill file is validated:

- **Required frontmatter**: `name` (lowercase, digits, hyphens, 2-64 chars), `description` (min 15 chars)
- **Content length**: 200 – 5,242,880 chars
- **Binary content detection**: rejects files with null bytes
- **Extension whitelist**: only `.md`, `.json`, `.yaml`, `.yml`, `.txt`, `.js`, `.ts`, `.py`, `.rs`, `.toml`
- **Path traversal check**: rejects files with `..` in path
- **Security scan**: 17 dangerous patterns checked

### Security Pattern Detection (`validator.js`)

```javascript
curl | sh                    // pipes remote content to shell
wget | sh                    // pipes remote content to shell
rm -rf ~/                    // destructive file removal
eval(atob(...))              // obfuscated code execution
AWS_SECRET_KEY=              // hardcoded credentials
process.env.* + fetch/http   // env var exfiltration
"ignore previous instructions"  // prompt injection
"reveal your system prompt"     // prompt extraction
.ssh/id_rsa access             // sensitive file access
```

### Bundle Validation (`validator.js`)

- `id`: lowercase, digits, hyphens (2-64 chars)
- `name`: min 3 chars
- `description`: min 15 chars
- `repo_url`: must be valid GitHub URL or `owner/repo` format
- `skills` array: each entry validated as ID, max 20 skills per bundle (warning)

## Extension Whitelist

Only the following file extensions are accepted: `.md`, `.json`, `.yaml`, `.yml`, `.txt`, `.js`, `.ts`, `.py`, `.rs`, `.toml`.

## Content Quality Filtering

### Hard Filter (`src/filter/hard-filter.js`)

Rejects by:
- **Filename**: README, LICENSE, CHANGELOG, CONTRIBUTING, SECURITY, AUTHORS, CREDITS, FAQ, INDEX, OVERVIEW, etc. (27 known names)
- **Filename pattern**: leading `_` or `.`, version-like (`v1.0`), date-like (`2024-01`)
- **Directory**: `.github`, `docs/`, `tests/`, `assets/`, `node_modules/`, `references/`, etc. (22 directory names)
- **Content**: starts with `# Readme`, contains badge images (shields.io, travis-ci)

### Soft Classifier (`src/filter/classifier.js`)

14-dimension feature vector analysis:
- Content length, header count, instruction headers, imperative verbs
- Code blocks, numbered lists, bullet points
- Paragraph structure, vocabulary diversity
- Centroid similarity (cosine distance to good/bad training means)
- Rule A override: catches skill-like content misclassified as reject

## Trust System

Registry entries have a `trust_level`:

| Level | Description |
|-------|-------------|
| `verified` | Manually audited, safe |
| `official` | Published by trusted source |
| `trusted` | Community but reputation-proven |
| `community` | Public contributions (default) |
| `unknown` | Not assessed |

Trust level is set server-side on the registry. Clients query but do not assign trust levels for community skills.

## Atomic Writes

Marketplace installs write to a `.tmp` file first, validate, then `rename()` to the final path. This prevents partial/corrupt skill files.

## Security for Imported Repos

When importing from GitHub:

1. Repo existence is verified (HTTP HEAD)
2. Skills directory auto-detected (API)
3. Sparse checkout limits fetched content
4. Every `.md` file validated through `isSkillFile()` and `validateSkill()`
5. Non-skill files (docs, tests, images) deleted after clone
6. Empty directories cleaned up

## Reporting Vulnerabilities

Report security issues by opening an issue on the [GitHub repository](https://github.com/NeiP4n/promptgraph/issues).

Do not open public issues for actively exploitable vulnerabilities. Contact the maintainer directly via GitHub.

## Disclaimer

PromptGraph downloads and executes skill files from third-party sources. While validation and scanning are applied, no guarantee of safety is made for community-published skills. Review skill content before running untrusted commands.
