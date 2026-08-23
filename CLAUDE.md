# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Manifest V3 Chrome extension ("Super Immersive Translate / 超级翻译") providing
immersive bilingual webpage translation, Saladict-style selection translation with
multi-engine parallel results, a document/OCR/website translation sandbox, PDF
translation, multi-site live-caption translation (video platforms + Zoom/Meet/Teams),
an FSRS spaced-repetition wordbook, and history. UI/comments are primarily in Chinese.

## Build & run

```bash
npm run build      # Vite + @crxjs/vite-plugin → outputs to dist/
npm run dev        # Vite dev server (HMR for the extension)
npm run typecheck  # tsc --noEmit — the only automated check this repo has
```

There is **no test framework or linter**. `npm run typecheck` is the sole automated gate,
and it matters: **Vite does not typecheck** — esbuild just strips types — so a build that
succeeds proves nothing about type correctness. Run typecheck before considering work done.
Everything else is manual: build, then load the **`dist/`** directory (not the repo root)
as an unpacked extension at `chrome://extensions/` with Developer Mode on.

Important build detail: the content scripts listed in `manifest.json`
(`utils/translator.js`, `content/selection.js`, etc.) are authored as **ES modules with
`import` statements**. They only work after `@crxjs/vite-plugin` rewrites them during the
build. The raw source files are not loadable as-is — always build and load `dist/`. The
`README.md` instruction to load the project folder directly is outdated.

Standalone HTML pages are separate Vite entry points (see `vite.config.js`): `sandbox/`,
`history/`, `wordbook/`, `pdf/` (plus `popup/` and `options/`). **All six are React 19 + TypeScript**,
each a thin `*.html` shell mounting `main.tsx` → `App.tsx`. They keep using
**Tailwind CSS 4 + daisyUI 5** for styling (see `.agents/skills/daisyui/SKILL.md`) with
**lucide-react** for icons. Each page's CSS starts with the Google Fonts `@import`
(must be the very first line — CSS requires `@import` before all other rules), then
`@import "tailwindcss"; @import "../styles/theme.css";` where `styles/theme.css` is the
single place daisyUI themes and the global font stack are set (add a theme there **and**
in `utils/theme.js`'s `AVAILABLE_THEMES`). Use daisyUI 5 color variables
(`var(--color-primary)`, `--color-success`, etc.) — not the daisyUI 4 short names
(`var(--p)`). Injected content-script CSS is hand-written, not Tailwind — see below.

**Content-script UI is split by whether it must flow with host content.** This split is
the rule; hand-written CSS is a consequence of it, not the point.

- **Overlays** — selection panel and trigger icon, the full-page progress bar, the input
  tooltip, the subtitle fallback caption — live in a **Shadow DOM** root
  (`content/shadow-ui.js`, one shared root, `all: initial` on the host). Their styles are
  in `content/selection.css` and `content/overlay.css`, imported with **`?inline`** so the
  text lands inside the shadow tree. Never import them for side effects: `@crxjs` would
  inject them into the host page and the isolation is gone. Two consequences to remember:
  document-level handlers must test `isInsideUi(event)` (`composedPath()`), because an
  event leaving a shadow tree retargets to the host and `e.target.closest('.sit-panel')`
  silently becomes null — the panel then closes on every click inside itself; and
  `document.querySelector` cannot see overlay elements, so hold references instead.
- **In-flow markup** — `.sit-translation` / `.sit-original` / `.sit-wrapper` /
  `.sit-hover-highlight` / `.sit-subtitle-translation` — must sit in the host DOM to lay
  out next to the text it translates, so it cannot be shadow-rooted. It stays in
  `content/content.css` + `content/subtitle.css` (page-injected), keeps the `sit-` prefix,
  and accepts that host CSS can reach it. `npm run verify` asserts these two files contain
  only those five classes; anything else belongs in `overlay.css`.

React is **not** used in content scripts. The reason is payload, not isolation: the
bundle is injected into every page visited (`selection.js` is ~6 kB gzip today, and
react+react-dom would add ~45 kB). Shadow DOM would make it safe — it is still not worth
it.

**MUI is used sparingly and on purpose.** `utils/mui-theme.tsx` bridges MUI's palette to
daisyUI's CSS variables and follows `data-theme`, and it deliberately does **not** render
`<CssBaseline />` — global reset stays with Tailwind/daisyUI, otherwise the two reset
layers fight. Only reach for MUI where daisyUI's pure-CSS components genuinely can't go:
`Autocomplete`, `Dialog`, `Snackbar`, `Tooltip`. Buttons/cards/badges stay daisyUI.
`popup/` imports no MUI at all — it opens on every toolbar click, so its bundle stays lean.

**TypeScript is partial by design.** `tsconfig.json` runs `strict` with `allowJs: true` and
`checkJs: false`: the six React pages and `utils/*.ts` are typed, while `content/*.js`,
`background/`, and the older `utils/*.js` (translator, srs, theme, defaults, github-sync)
are still JavaScript. Shared data contracts live in `types/models.ts` (`WordEntry`,
`WordContext`, `Token`, `SerializedCard`, `HistoryEntry`, `SubtitleAdapter`, `Toast`);
`types/globals.d.ts` declares the side-effect globals (`window.ttsManager`,
`window.translator`) and the `SpeechRecognition` API that TS's DOM lib still omits.

Theming is global and unified via `utils/theme.js`: pages call `applyTheme()` (sets
`data-theme` from `chrome.storage.sync.theme`, value `system|light|dark`, default `system`,
following `prefers-color-scheme`) and `initThemeControl(container)` (renders the daisyUI
theme `<select>`). Theme changes sync live across all open pages via `chrome.storage.onChanged`.

## Architecture

### Translation core: `utils/translator.js`
The single source of translation logic. A `Translator` class wraps ~11 engines
(`Translator.ENGINES`): free (google, mymemory, lingva, libre, ollama, webllm) and
key-required (deepl, custom, openai, gemini, claude).

Key mechanisms to preserve when editing:
- **Batching queue**: `translate(text)` enqueues and flushes after `BATCH_DELAY` (50ms) or
  at `MAX_BATCH` (50). Each engine has a `_<engine>Batch()` method.
- **Separator protocol**: batched texts are joined with `\n▁▁▁\n` (U+2581 ×3), sent as one
  request, and split back. AI engines are instructed to preserve this separator verbatim in
  `_getAiPrompt()`. If the split count mismatches, code falls back to per-text requests.
- **Google fallback**: any engine error in `_flushQueue()` retries the batch via Google
  before giving up.
- **Cache**: keyed `engine:targetLang:text`.

A shared singleton `translator` is exported and also set on `window.translator`. The
selection feature instead instantiates **one `Translator` per engine** to run multiple
engines in parallel and aggregate their results in the panel.

### Content scripts (injected, order matters — see `manifest.json`)
1. `utils/translator.js` — must load first; others depend on it.
2. `content/selection.js` — Saladict-style selection translation. 5 trigger modes
   (`icon`/`direct`/`dblclick`/`shortcut`/`off`), draggable/pinnable panel, multi-engine
   parallel results, TTS, wordbook save, history save.
3. `content/content.js` — full-page bilingual translation. Walks the DOM classifying nodes
   via `SKIP_TAGS`/`INLINE_TAGS`/`BLOCK_TAGS`, wraps translated blocks, supports
   bilingual/replace/translation-only display modes, hover-to-translate, SPA support via
   MutationObserver, site blacklist/whitelist, and abortable in-progress translation
   (`translateAbortId`).
4. `content/input-translate.js` — live bilingual translation inside editable inputs.
5. `content/subtitle.js` — Multi-site live-caption bilingual translation (config-driven
   adapter registry in `content/subtitle-adapters.js`, one small config per site — see
   `docs/superpowers/specs/2026-06-03-multi-site-subtitles-design.md`). Falls back to a
   generic `<video>` textTrack cue watcher when no site adapter matches. Toggle via the
   `subtitleTranslate` setting.

### Background: `background/background.js`
Minimal MV3 service worker. Registers context menus and the `Alt+T` / `Alt+S` commands
(declared in `manifest.json` `commands`), and forwards them to the active tab's content
script via `chrome.tabs.sendMessage`. Also answers `getSettings` messages.

### Settings = the cross-module contract
All modules read/write `chrome.storage.sync`. Settings keys (engine, targetLang, sourceLang,
selectionMode, selectionEngines, per-engine keys/URLs/models, aiPrompt, displayMode,
siteRules, siteEngines, translation style vars, etc.) are an implicit shared schema across
`popup/`, `options/`, all content scripts, and `translator.js`. **Default values live in
one place: `utils/defaults.js` (`DEFAULTS` + a `pick(...)` helper).** Consumers read the
whole schema via `chrome.storage.sync.get(DEFAULTS)` or a subset via `get(pick('a','b'))`,
so adding a setting means adding it to `DEFAULTS` once. Modules react live via
`chrome.storage.onChanged`. (A few narrow single-key reads — `pdf/`, `input-translate.js`,
`theme.js` — still inline their one default.)

Styling is applied through CSS custom properties (`--sit-*`) on `document.documentElement`
and a `data-sit-mode` attribute, set from stored style settings — not by editing injected
CSS.

### Standalone pages

All six follow the same shape: `*.html` shell → `main.tsx` → `App.tsx`, with views/tabs
split into their own components.

- `popup/` — toolbar popup: quick engine/lang/mode settings. **No MUI** (latency-sensitive).
- `options/` — full settings page, 6 tabs under `options/tabs/`
  (general/style/shortcuts/sites/tts/data). `lib/useSettings.ts` owns the save policy:
  dropdowns/checkboxes write immediately, text inputs debounce 500ms — `chrome.storage.sync`
  has a per-minute write quota, so per-keystroke writes get throttled.
- `sandbox/` — multi-tab translation workbench under `sandbox/tabs/`
  (text / image / doc / web, plus a panel-only「当前页」tab). Opens as a tab (`?tab=`) or as a
  Chrome **Side Panel** (`chrome.sidePanel`, `?context=panel` from the popup「侧边栏」button or
  the right-click menu). In panel mode「当前页」follows the active browser tab, shows live page
  selections (content script broadcasts `panelSelection` on mouseup), and can toggle full-page
  translation. `.panel` on `<html>` gates narrow-width CSS.
  - Image OCR calls the third-party **ocr.space** API with its public demo key — images are
    uploaded off-device, and the UI says so. It is *not* local `tesseract.js` OCR, despite
    `tesseract.js` still being a dependency.
  - The doc tab shares `pdf/lib/pdfExtract.ts` with the PDF viewer.
- `pdf/` — PDF/TXT/MD/HTML document viewer. `lib/pdfExtract.ts` holds the extraction logic
  (text extraction only — layout-preserving rendering is a planned, unbuilt subsystem).
- `wordbook/` — saved-word study UI. Views under `wordbook/views/`: FSRS review, list,
  flashcards, spelling quiz, stats, JSON import/export. `lib/useWordbook.ts` is the single
  read/write entry and **must** keep its `chrome.storage.onChanged` listener: background
  GitHub sync writes to `wordbook` while the page is open, and without it a stale in-memory
  snapshot silently overwrites synced changes on the next save.
- `history/` — selection-translation history (same `onChanged` requirement).
- `utils/tts.js`, `utils/webllm-worker.js` — TTS helper and the Web Worker for in-browser
  WebLLM inference (`@mlc-ai/web-llm`).

Shared across pages: `utils/langs.ts` (language lists) and `utils/translation-options.ts`
(engine lists, per-engine config fields, colors). Add a language or engine **there**, not in
a page — these used to be hand-copied into each page's `<option>` markup.
