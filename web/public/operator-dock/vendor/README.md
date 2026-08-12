# Vendored screenshot capture

**File:** `html2canvas.min.js` (filename kept for consumer script tags)

| | |
|---|---|
| **Package** | [html2canvas-pro](https://www.npmjs.com/package/html2canvas-pro) **2.3.5** |
| **Source artifact** | `dist/html2canvas-pro.min.js` (UMD; exposes global `html2canvas`) |
| **Why not stock html2canvas 1.4.1** | Stock dies on CSS Color Level 4 `oklch()` / `oklab()` (Tailwind v4 computed styles) with `Attempting to parse an unsupported color function "oklch"`. Dock markup then fail-closes with "Screenshot capture failed". |
| **Issue** | [#145](https://github.com/heavygee/hapi-inline/issues/145) |

Consumers keep:

```html
<script src="/operator-dock/vendor/html2canvas.min.js"></script>
```

Dock contract unchanged: `typeof html2canvas === 'function'`.

Re-vendor: `npm pack html2canvas-pro@2.3.5` → copy `package/dist/html2canvas-pro.min.js` over this path. Prefer newer `2.3.x` patches when bumping.
