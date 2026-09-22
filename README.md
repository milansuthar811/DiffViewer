# Diff Tool

A lightweight, client-side text diff tool with side-by-side word-level comparison, syntax highlighting, and shareable links. Deployable to GitHub Pages with zero configuration.

## Features

- **Side-by-side comparison** - Original and modified text displayed next to each other
- **Word-level diff** - Granular highlighting of added/removed/changed words
- **Shareable links** - Encode diff state in URL hash (no backend needed)
- **Advanced options**:
  - Trim whitespace
  - Ignore case
  - Ignore all whitespace
  - Toggle word/character level
  - Show/hide unchanged content
- **Synced scrolling** - Both panes scroll together
- **Dark/light mode** - Automatic via system preference
- **Zero dependencies** - Pure vanilla JS, ~3KB gzipped
- **GitHub Pages ready** - Deploy in one click

## Quick Start

```bash
# Clone and serve locally
git clone <your-repo>
cd diff
npx serve .
# or python3 -m http.server 8000
```

Open `http://localhost:8000` (or whatever port).

## Deploy to GitHub Pages

1. Push this folder to a GitHub repository
2. Go to **Settings → Pages**
3. Source: **Deploy from a branch**
4. Branch: `main` / `/(root)`
5. Save → Your site is live at `https://<username>.github.io/<repo>/`

## Usage

1. Paste text in **Original** (left) and **Modified** (right) panels
2. Click **Compare** or press `Ctrl+Enter`
3. Adjust options in **Advanced Options** as needed
4. Click **Share Link** to copy a URL containing the full diff state
5. Send the link - recipient sees identical comparison

## Shareable Links

Links encode everything in the URL hash:
```
https://yoursite.com/#eyJsZWZ0IjoiSGVsbG8iLCJyaWdodCI6IkhlbGxvIFdvcmxkIiwib3B0aW9ucyI6e30=
```

- No server storage - fully client-side
- Works offline after first load
- Base64 + URI encoded JSON

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Ctrl+Enter` | Run diff |
| `Esc` | Clear (when focused on textarea) |

## Algorithm

Uses standard LCS (Longest Common Subsequence) dynamic programming for optimal diff computation. Word-level tokenization splits on whitespace boundaries while preserving whitespace tokens for accurate rendering.

## Browser Support

All modern browsers (ES2017+). No polyfills needed.

## License

MIT - Use freely.
