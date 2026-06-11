# Definition of Done (DoD)

## Feature / Enhancement

- [ ] Code written, reviewed, and merged to main
- [ ] Tests added (unit or integration) — or skip reason documented
- [ ] CHANGELOG.md updated with user-facing change + rationale
- [ ] README.md updated if new command/flag/behavior
- [ ] MCP API changes documented in `.mcp.json`
- [ ] No breaking changes to CLI or config format (or major version bump if breaking)
- [ ] npm publish executed (version bump in package.json)
- [ ] Git tag created (optional, for major releases)
- [ ] No console errors or warnings on typical workflows

## Bug Fix

- [ ] Root cause identified and documented (comment/CHANGELOG)
- [ ] Fix applied to minimal scope (don't refactor)
- [ ] Reproduction test added (unit or manual steps in CHANGELOG)
- [ ] CHANGELOG.md updated with: **What broke**, **Why**, **How fixed**
- [ ] Version bump (patch release)
- [ ] npm publish
- [ ] Tested on Windows + macOS/Linux (if platform-specific)

## Chore / Docs / Internal

- [ ] Change merged to main
- [ ] No version bump needed (unless significant tooling change)
- [ ] CHANGELOG updated only if user-visible impact

---

## Token Optimization

**For Claude Code sessions:**
- Load CHANGELOG (recent 3 releases only) + DoD in context from session start
- Use `/context-compression` to summarize project state if context > 60%
- Avoid re-reading git history — trust git log output
- Use git blame sparingly; prefer grep for symbol search
- Batch independent file reads/writes in parallel tool calls
- For large files (>500 lines): read only relevant sections with grep/offset

**For long sessions (>50 tool calls):**
- Suggest `/compact` to prune context
- Use LAST_SESSION.md handoff file at session end
- Store unfinished tasks in LAST_SESSION.md for next session

---

## Release Checklist (Before npm publish)

1. [ ] All fixes tested locally
2. [ ] CHANGELOG updated
3. [ ] Package version bumped
4. [ ] `npm publish` successful
5. [ ] `git add + commit + push` to GitHub
6. [ ] Tag created if major release

---

## Known Bugs (Current Issues to Fix)

### 0. **Marketplace bundles broken** (CRITICAL) ✅ FIXED
- **Status**: ✅ RESOLVED (2026-06-11)
- **Severity**: Was Critical (bundle listing + repo install dead)
- **Location**: `marketplace.js` → `localSkillCount()`
- **Problem**: Referenced `SKILLS_STORE_DIR` which was never imported → `ReferenceError`. `browseBundles()` caught it and returned `Registry unavailable`; `_execRepoInstall()` reported failure after a successful clone.
- **Fix Applied**: Resolve dir via `getSkillsStoreDir()`; exported `localSkillCount` + added 3 regression tests.

### 1. **TAR Module Export Error** (CRITICAL) ✅ FIXED
- **Status**: ✅ RESOLVED
- **Severity**: Was Critical (prevented test suite)
- **Location**: `fastembed` → `tar@7.5.16` incompatibility
- **Problem**: 
  - tar 7.x removed default export, uses named exports only
  - fastembed (or onnxruntime-node) tried to use default export
- **Fix Applied**: 
  - Downgraded tar to 6.2.1 in `package.json` overrides
  - ✅ All 264 tests now pass (was: 139 pass + 6 fail suites)
- **Resolution Date**: 2026-06-10
- **Note**: tar 6.2.1 has some security warnings but works; consider upgrading fastembed when it supports tar 7.x

### 2. **Vitest Mock Hoisting Warnings** (MEDIUM) ⚠️ PARTIAL
- **Status**: ⚠️ STILL WARNINGS (2 warnings)
- **Severity**: Medium (will be error in future vitest)
- **Location**: `tests/vector-store.test.js` lines 357, 370
- **Problem**: 
  - vi.mock('../db.js') calls nested inside it() blocks (not module-level)
  - Vitest 4.1.8 warns about this hoisting behavior
- **Impact**: Tests pass, but future vitest versions will error
- **Recommended Fix**: 
  - Move `vi.mock('../db.js')` to top-level before describe blocks
  - Use vi.mocked() inside it() blocks to change behavior per-test
- **Todo**: [ ] Refactor vector-store.test.js ANN Index tests (lines 356-378)

---

## v3.0 Ideas (Major Release)

> Факты из кодовой базы, на которых основаны идеи. Ни одна не придумана.

---

### 🔴 Breaking / Architecture

**1. Multilingual embedder (replace BGE-Small-EN-v1.5)**
- **Факт**: `embedder.js` хардкодит `EmbeddingModel.BGESmallENV15` — English-only модель. Пользователи с русскими скиллами (как этот проект) получают деградацию качества поиска.
- **Факт**: `embed-cache.db` кэшируется по `md5(MODEL_TAG + text)` где `MODEL_TAG = 'bge-small-en-v1.5'`. Смена модели = cache invalidation автоматически (уже заложено).
- **Идея**: Сменить на `paraphrase-multilingual-MiniLM-L12-v2` или `bge-m3` — обе поддерживаются fastembed, работают на CPU. Это breaking change (HNSW индекс + кэш перестраиваются).
- **Сложность**: Medium (замена 1 строки, но полный reindex у всех пользователей)

**2. Persistent HNSW — убрать full rebuild на каждый reindex**
- **Факт**: `indexer.js` → `buildAnnIndex()` каждый раз пересоздаёт весь HNSW с нуля из всех чанков в БД. При 20 359 векторах — ~30 секунд и пик памяти даже после `freeModel()`.
- **Факт**: `hnswlib-node` поддерживает `index.addPoint()` инкрементально и `index.writeIndex()` / `index.readIndex()`.
- **Идея**: Хранить HNSW файл в `.promptgraph/ann.bin` и только добавлять новые векторы при incremental reindex. Full rebuild только при смене модели или `pg doctor --rebuild`.
- **Сложность**: High (нужна sync между SQLite chunks и HNSW id)

**3. fastembed upgrade (tar 7.x)**
- **Факт**: `package.json` → `"overrides": { "tar": "^6.2.0" }` — вынужденный даунгрейд из-за несовместимости fastembed с tar 7.x. tar 6.2.x имеет security warnings.
- **Идея**: Дождаться/подтолкнуть fix в fastembed, затем убрать override. Это unblock для v3.0.
- **Сложность**: Low (удалить 3 строки из package.json когда fastembed починят)

---

### 🟡 Search Quality

**4. Hybrid search: BM25 + vector**
- **Факт**: `search.js` использует только cosine similarity по HNSW. При точном совпадении слов (команда, имя скилла) BM25 дал бы score 1.0, тогда как вектор может промахнуться.
- **Факт**: SQLite FTS5 уже есть в better-sqlite3, дополнительная зависимость не нужна.
- **Идея**: При `pg search` делать параллельный FTS5 запрос + ANN, затем RRF (Reciprocal Rank Fusion). Улучшает точность для коротких запросов типа `"safe refactor"`.
- **Сложность**: Medium

**5. Query expansion / rewrite**
- **Факт**: `embedder.js:embed()` получает сырой запрос пользователя. Если пользователь пишет по-русски ("отрефактори без багов"), embedder получает русский текст и матчит с английскими скиллами — плохо.
- **Факт**: Система уже умеет звать LLM (это MCP сервер внутри Claude). Можно попросить Claude расширить запрос на английский перед embed.
- **Идея**: Опциональный `PG_QUERY_EXPAND=1` режим: перед embed посылать запрос в `pg_search` через маленькую Claude Haiku промпт для перевода/расширения.
- **Сложность**: Medium (нужен дополнительный MCP roundtrip)

---

### 🟡 Registry & Publishing

**6. Децентрализованный реестр (федеративный)**
- **Факт**: `marketplace.js` тянет `https://raw.githubusercontent.com/NeiP4n/promptgraph-registry/main/registry.json` — единственный источник. Если репозиторий удалён/недоступен — всё мертво.
- **Факт**: `config.js` уже хранит `sources[]` — массив источников для индексации. Аналогичная структура применима к реестрам.
- **Идея**: Поддержка нескольких реестров в конфиге (`pg registry add <url>`). Локальный реестр по умолчанию + community. Bundles из разных реестров мёрджатся.
- **Сложность**: Medium

**7. Bundle manifest v2 с зависимостями**
- **Факт**: Текущий bundle формат (`registry.json`) поддерживает `skills[]`, `tool_files[]`, `repo_url`, `has_tools` — но нет зависимостей между бандлами.
- **Факт**: `installBundle()` в `marketplace.js` не проверяет, установлены ли скиллы, на которые может ссылаться данный бандл.
- **Идея**: `requires: ["bundle-id-1", "bundle-id-2"]` в манифесте. `installBundle` рекурсивно доустанавливает зависимости.
- **Сложность**: Medium

---

### 🟢 UX / CLI

**8. `pg search` с preview в TUI**
- **Факт**: CLI `pg search <query>` (в `commands/search.js`) просто печатает список результатов в stdout. TUI marketplace уже реализован с навигацией.
- **Идея**: Добавить интерактивный режим: `pg search` без аргументов открывает TUI с live-поиском + preview скилла при выборе (первые 400 символов). Enter — запустить скилл инструкцию.
- **Сложность**: Medium (переиспользовать tui.js)

**9. `pg doctor` автоматический repair**
- **Факт**: `commands/doctor.js` только диагностирует. Пользователь видит "5 chunks orphaned" но должен сам чинить.
- **Факт**: Orphan cleanup уже есть в `db.js` как отдельные SQL запросы, вызываемые в других местах.
- **Идея**: `pg doctor --fix` автоматически применяет все найденные исправления с отчётом что было сделано. Dry-run по умолчанию, `--fix` для применения.
- **Сложность**: Low

**10. Skill preview в TUI перед установкой**
- **Факт**: TUI (`tui.js`) показывает только name + description + code. При нажатии Enter сразу начинается установка.
- **Факт**: `raw_url` у каждого скилла в реестре уже есть — можно скачать и показать превью.
- **Идея**: Нажатие `Space` или `P` в TUI показывает первые 400 символов скилла (fetch по raw_url) до установки. `Enter` — устанавливает.
- **Сложность**: Low

---

### 🟢 Fixes (должны войти в 3.0 до выпуска)

- [ ] **Vitest hoisting warnings** в `tests/vector-store.test.js:357,370` — перенести `vi.mock('../db.js')` на уровень модуля
- [ ] **fastembed tar override** — убрать когда fastembed починят
- [ ] **`pg status` — показывать has_tools для установленных бандлов** — сейчас `status.js` не выводит эту информацию

---

## Feature Ideas & Enhancements (Backlog)

### User Requests (Add here)
- [ ] **Feature**: [description]
  - **Why**: [user request/pain point]
  - **Complexity**: Low/Medium/High
  - **Blocks**: [other features if any]

### Performance Ideas
- [ ] **Parallel skill indexing**: Index multiple directories concurrently
  - **Why**: Large skill directories (1000+ files) take too long
  - **Current**: Sequential indexing via glob + chunking
  - **Idea**: Use Worker threads or Promise.all batches
  - **Complexity**: Medium

- [x] **Embedding caching strategy**: Cache embeddings between sessions ✅ DONE (2026-06-11)
  - **Why**: Re-indexing same skills repeatedly wastes compute
  - **Implemented**: `embed-cache.js` — content-addressed SQLite cache at `~/.claude/.promptgraph/embed-cache.db`, keyed by `md5(model+text)`. Plus in-batch dedup of identical texts. Cold→cached: 13.3s→5ms measured. Disable via `PG_NO_EMBED_CACHE=1`.

- [ ] **Lazy-load embedder model**: Don't init FlagEmbedding until first search
  - **Why**: `pg` CLI commands that don't search (install, list, etc.) spend 2-3s loading model
  - **Current**: Model loaded on every `getEmbedder()` call
  - **Idea**: Lazy init only for search operations
  - **Complexity**: Low

### Feature Ideas
- [ ] **Skill ratings & usage stats**: Track which skills Claude actually uses
  - **Why**: Know which installed skills are dead weight
  - **Implementation**: Log tool_use events, aggregate in ~/.claude/.promptgraph/stats.json
  - **Complexity**: Medium

- [ ] **Skill versioning**: Support skill@version in config
  - **Why**: Pinned versions prevent silent breaking changes
  - **Current**: Always uses latest
  - **Idea**: tag system + registry metadata
  - **Complexity**: High

- [ ] **Skill dependency management**: If skill A requires skill B, auto-install B
  - **Why**: Currently must manually install transitive deps
  - **Complexity**: High

- [ ] **MCP-native skill loading**: Load skills directly as MCP resources
  - **Why**: Skills are already SKILL.md files; could be MCP-served
  - **Current**: pg loads via filesystem
  - **Idea**: Expose skills as MCP tool library
  - **Complexity**: High

### UX Ideas
- [ ] **Search result ranking by skill freshness**: Newer skills ranked higher
  - **Why**: Old deprecated skills often score high despite being abandoned
  - **Complexity**: Low

- [ ] **Interactive skill browser UI**: Web UI for browsing/installing skills
  - **Why**: CLI search feels clunky for discovery
  - **Current**: `pg search query` + manual install
  - **Complexity**: High

- [ ] **Skill preview before install**: Show first 200 chars of SKILL.md
  - **Why**: Users install skills blind, then regret
  - **Complexity**: Low

---

## Test Coverage Status

**Current**: ✅ **264 TESTS PASSING** (2026-06-10)
- ✅ All 14 test suites passing:
  - ✅ chunker.test.js
  - ✅ db.test.js
  - ✅ github-import.test.js
  - ✅ import-config-cleanup.test.js
  - ✅ indexing-chunk-ann.test.js
  - ✅ marketplace.test.js (fixed mock issue)
  - ✅ parser-score.test.js
  - ✅ parser.test.js
  - ✅ reranker.test.js
  - ✅ safety-limits.test.js
  - ✅ search-db-doctor.test.js
  - ✅ validator-security.test.js
  - ✅ validator.test.js
  - ✅ vector-store.test.js

**Remaining warnings**: 2 vitest hoisting warnings (non-blocking, fix recommended)

**Run tests**: 
```bash
npm test
# Result: Test Files  14 passed (14) | Tests  264 passed (264)
```
