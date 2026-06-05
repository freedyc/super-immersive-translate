# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Manifest V3 Chrome extension ("Super Immersive Translate / 超级翻译") providing
immersive bilingual webpage translation, Saladict-style selection translation with
multi-engine parallel results, a document/OCR/website translation sandbox, PDF
translation, YouTube subtitle translation, a wordbook, and history. UI/comments are
primarily in Chinese.

## Build & run

```bash
npm run build      # Vite + @crxjs/vite-plugin → outputs to dist/
npm run dev        # Vite dev server (HMR for the extension)
```

There is **no test framework, linter, or typecheck** configured. Verification is manual:
build, then load the **`dist/`** directory (not the repo root) as an unpacked extension at
`chrome://extensions/` with Developer Mode on.

Important build detail: the content scripts listed in `manifest.json`
(`utils/translator.js`, `content/selection.js`, etc.) are authored as **ES modules with
`import` statements**. They only work after `@crxjs/vite-plugin` rewrites them during the
build. The raw source files are not loadable as-is — always build and load `dist/`. The
`README.md` instruction to load the project folder directly is outdated.

Standalone HTML pages are separate Vite entry points (see `vite.config.js`): `sandbox/`,
`history/`, `wordbook/`, `pdf/` (plus `popup/` and `options/`). **All six standalone pages
use Tailwind CSS 4 + daisyUI 5 + Lucide icons** (see `.agents/skills/daisyui/SKILL.md` for
daisyUI conventions). Each page's CSS does `@import "tailwindcss"; @import "../styles/theme.css";`
where `styles/theme.css` is the single place daisyUI themes are enabled (add a theme there
**and** in `utils/theme.js`'s `AVAILABLE_THEMES`). Use daisyUI 5 color variables
(`var(--color-primary)`, `--color-success`, etc.) — not the daisyUI 4 short names
(`var(--p)`). The injected `content/*.css` (full-page/selection/youtube) is deliberately
hand-written, not Tailwind, to avoid polluting host pages.

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
5. `content/youtube.js` — YouTube subtitle detection + bilingual captions.

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
- `popup/` — toolbar popup: quick engine/lang/mode settings.
- `options/` — full settings page (5 sections: general/style/shortcuts/sites/data).
- `sandbox/` — multi-tab translation workbench (text, image OCR via `tesseract.js`, doc,
  website), clipboard paste. Opens either as a tab (`?tab=`) or as a Chrome **Side Panel**
  (`chrome.sidePanel`, opened with `?context=panel` from the popup「侧边栏」button or the
  right-click menu). In panel mode it adds a「当前页」tab that follows the active browser tab,
  shows live page selections (content script broadcasts `panelSelection` on mouseup), and can
  toggle full-page translation. `sandbox.js` branches on `isPanel`; `.panel` on `<html>` gates
  narrow-width CSS.
- `pdf/` — PDF/TXT/MD/HTML document translation viewer.
- `wordbook/` — saved-word study UI (list, flashcards, spelling quiz, stats, JSON import/export).
- `history/` — selection-translation history.
- `utils/tts.js`, `utils/webllm-worker.js` — TTS helper and the Web Worker for in-browser
  WebLLM inference (`@mlc-ai/web-llm`).
