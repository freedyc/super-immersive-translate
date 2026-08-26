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
  inject them into the host page and the isolation is gone. Three consequences to remember:
  document-level handlers must test `isInsideUi(event)` (`composedPath()`), because an
  event leaving a shadow tree retargets to the host and `e.target.closest('.sit-panel')`
  silently becomes null — the panel then closes on every click inside itself;
  `document.querySelector` cannot see overlay elements, so hold references instead; and
  **every `position: absolute` overlay needs an explicit width** (`width: max-content` is
  usually right) — the host is a `width: 0` box, so shrink-to-fit resolves the available
  width to 0 and the element collapses to its minimum content width, which for CJK text
  with `word-break` is one character per line. `verify` asserts this.
- **In-flow markup** — `.sit-translation` / `.sit-original` / `.sit-wrapper` /
  `.sit-hover-highlight` / `.sit-subtitle-translation` — must sit in the host DOM to lay
  out next to the text it translates, so it cannot be shadow-rooted. It stays in
  `content/content.css` + `content/subtitle.css` (page-injected), keeps the `sit-` prefix,
  and accepts that host CSS can reach it. `npm run verify` asserts these two files contain
  only those five classes; anything else belongs in `overlay.css`.

**TTS engines are declared in one registry, and configured per language.**
`utils/tts-engines.js` holds every engine's capabilities — whether it needs a key, whether
it can speak Chinese, its per-request character cap — and the settings page, `utils/tts.js`,
and the background fetcher all read that one list. Engine and browser voice are stored
**per language** (`ttsEngineEn`/`ttsEngineZh`, `ttsBrowserVoiceEn`/`ttsBrowserVoiceZh`);
`resolveTts(settings, lang)` is the only way to read them and falls back to the pre-split
`ttsEngine`/`ttsBrowserVoiceURI` so upgrades need no storage migration — but it refuses to
hand a Chinese legacy voice to English, which is exactly the bug the split fixes. Rate and
pitch stay shared: they are subjective and language-independent. Four engines: `browser` (offline, all languages), `google` (free, keyless,
good Chinese and English), `youdao` (free, keyless, human recordings, **English only** —
Chinese requests return 500), `openai` (needs a key). `speak()` downgrades to `browser`
when the chosen engine cannot handle the language or has no key, rather than failing.

`speak()` initialises itself and `utils/tts.js` re-reads settings on
`chrome.storage.onChanged`. Both matter: the wordbook page only ever imported the module
and called `speak()` directly, so without lazy init it silently used constructor defaults
and no TTS setting ever applied there; and without the listener an already-open page keeps
the settings it started with, so changing the engine in options appears to do nothing.

Network audio is fetched **in the service worker** (`ttsFetch`) and returned as a data URL.
A content script's own cross-origin fetch is bound by the host page's CORS — extension
`host_permissions` do not apply there — and a blob URL made in the worker is dead in any
other context. Google caps a request near 200 chars, so `chunkText()` splits on sentence
ends and plays the pieces in sequence.

**Phonetics and part of speech come from bundled dictionaries, not the AI engine.**
Both are dictionary data. Before this they were AI-only, and since the default config has
no AI engine (`engine: 'google'`, all keys empty, Ollama fallback unreachable) both fields
were silently always empty.

- `public/data/phonetics/{a..z}.json` — 117k words, CMUdict converted ARPAbet→IPA by
  `scripts/build-phonetics.mjs` (BSD). **US pronunciation only.**
- `public/data/pos/{a..z}.json` — 78k words, WordNet 3.1's four open classes plus the six
  closed classes enumerated in `scripts/build-pos.mjs` (Princeton license). Values are
  **codes** (`run` → `vn`), ordered by sense count; `formatPos()` in
  `utils/learning/wordMeta.ts` maps them to the ten Chinese labels, so changing the copy
  does not mean regenerating 1.2 MB of data.

Keep each `LICENSE` beside its data. Both are sharded by first letter and loaded on demand
**inside the service worker**, which answers one `lookupWordMeta` message returning both;
callers use `utils/dictionary-client.js`. Never load a shard in a content script — that
would pay ~94 KB per page. Regenerate with
`node scripts/build-phonetics.mjs <cmudict.dict> public/data/phonetics` and
`node scripts/build-pos.mjs <wordnet-dir> public/data/pos`.

Never store a placeholder like `'未知'` in `partOfSpeech`. It is truthy, so it makes every
`!pickPos(word)` backfill guard fail and permanently blocks the real value from ever being
written. Leave the field empty instead; `verify` asserts this.

React is **not** used in content scripts. The reason is payload, not isolation: the
bundle is injected into every page visited (`selection.js` is ~6 kB gzip today, and
react+react-dom would add ~45 kB). Shadow DOM would make it safe — it is still not worth
it.

**MUI is used sparingly and on purpose.** `utils/mui-theme.tsx` bridges MUI's palette to
daisyUI's CSS variables and follows `data-theme`, and it deliberately does **not** render
`<CssBaseline />` — global reset stays with Tailwind/daisyUI, otherwise the two reset
layers fight. Only reach for MUI where daisyUI's pure-CSS components genuinely can't go:
`Autocomplete`, `Dialog`, `Snackbar`, `Tooltip`. Buttons/cards/badges stay daisyUI — the
per-engine concurrency cards were built with MUI once and reverted: Material's elevation
and type scale read as foreign next to the rest of the settings page.
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

**Content scripts must import what they use — never rely on the manifest's `js` order.**
`@crxjs` turns each entry into an asynchronously loaded module, so two entries have no
guaranteed execution order. `content/selection.js` used to read `window.ttsManager` on the
strength of `utils/tts.js` being listed before it, which failed randomly with
`Cannot read properties of undefined`. Write the real `import` instead: entries share the
same emitted chunk, so the module body still runs exactly once. `verify` asserts that any
content script touching `window.ttsManager` / `window.translator` imports its provider.

**Key-bearing APIs and local Ollama must go through the service worker.** Since Chrome 85
a content script's cross-origin fetch is bound by the *host page's* CORS — extension
`host_permissions` do not exempt it there — and OpenAI, Gemini, Claude and DeepL send no
CORS headers to browsers while Ollama only allows localhost origins by default. Those
engines therefore cannot reach the network from `content/selection.js` at all. `utils/net.js`
`request()` decides by environment: content script → `proxyFetch` message to the worker;
extension page or worker → direct fetch. The free engines (Google/MyMemory/Lingva/Libre)
send their own CORS headers and stay direct — routing them would only add a message
round-trip. A side benefit: every AI request now originates from
`chrome-extension://<id>`, so `OLLAMA_ORIGINS` can name that one origin instead of `*`.

### Background: `background/background.js`
Minimal MV3 service worker. Registers context menus and the `Alt+T` / `Alt+S` commands
(declared in `manifest.json` `commands`), and forwards them to the active tab's content
script via `chrome.tabs.sendMessage`. Also answers `getSettings` messages.

### Clipboard history (`content/clipboard.js` → `utils/clipboard.js`)
Every copy on a page is recorded to `chrome.storage.local.clipboardHistory` and shown in
the `history/` page's second tab. Two rules are load-bearing: password/OTP fields and
untrusted (script-synthesised) copy events are never recorded, and capture must never
throw — it runs inside the user's real copy action.

Images live in a **separate store**: `utils/image-store.js` (IndexedDB, one Blob per
record), captured by the `save-image-to-clipboard` context menu **in the service worker** —
a content script's IndexedDB belongs to the host page's origin, so anything it wrote would
be invisible to extension pages. They are deliberately not in the text array: that array is
read-and-rewritten whole on every copy, so a few MB of image would be re-serialised each
time you copy text. Images are **not synced** — the Contents API tops out around 1MB.
Listing strips `blob` and returns only the thumbnail; the full image is fetched by id on
demand. Copying back converts non-PNG to PNG first — the clipboard only reliably accepts
`image/png`.

GitHub sync for the text side is **end-to-end encrypted and opt-in** (`githubSyncClipboard`).
`utils/crypto.js` does AES-256-GCM with a key derived by PBKDF2-SHA256 (600k iterations,
fresh random salt and IV per encryption). The design rule that must never be relaxed: **no
passphrase means no upload** — the sync throws rather than degrading to plaintext, and a
wrong passphrase aborts instead of overwriting the remote with local data. The passphrase
lives in `chrome.storage.local`, never in `sync` — syncing it would hand the ciphertext to
GitHub and the key to Google. Asymmetric keys were deliberately not used: the private key
would have to reach every device anyway, so it reduces to protecting a secret with a
passphrase, with more ways to lose the data. `generateRecoveryKey()` covers the
"hold the key" case by generating a 260-bit passphrase to store in a password manager.

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
