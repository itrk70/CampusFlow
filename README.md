# CampusFlow — v2.0.0

A privacy-first, offline schedule tracker for students. No login, no server, no database — everything lives in your browser's `localStorage`. This version adds attendance tracking, a Works (assignments/lab) tracker, a campus Events board, a digital student ID card, and a developer page.

## What's inside

```
index.html            Main app shell (Dashboard, Classes, Works, Events, Settings)
style.css             All styling — design tokens, layout, dark mode, animations
app.js                All logic — storage, status engine, notifications, ID card, etc.
events-data.js        Admin-edited list of campus events (see below)
presets-data.js       Admin-edited class/group presets (see below)
developer/index.html  Standalone "About the developer" page at /developer/
assets/
  id-card-mockup.png  Blank lanyard-card mockup used to render the digital ID
```

`events-data.js` and `presets-data.js` embed their data directly as JS objects (assigned onto `window`) rather than being fetched as separate `.json` files. This is deliberate: `fetch()` of local JSON files is blocked by the browser under `file://` (i.e. double-clicking `index.html` instead of serving it), which is the most common way people first test a static site. Embedding the data sidesteps that entirely and works identically whether you're testing locally or live on GitHub Pages.

No build step, no npm install, no bundler. Everything is plain HTML/CSS/JS plus two CDN scripts (Google Fonts, pdf.js) and the FontAwesome kit script for the developer page's icons.

## Before you deploy — things to personalize

1. **Developer page** (`developer/index.html`): replace the placeholder name, bio, avatar image, and the LinkedIn/GitHub URLs with your own. The avatar is currently an inline placeholder silhouette — swap the `src` for a real photo (a data URL, or a hosted image).
2. **FontAwesome kit**: both `index.html` and `developer/index.html` load `https://kit.fontawesome.com/826e39b053.js` — this is the kit ID you provided. If you rotate or replace your kit, update it in both files.
3. **Events**: `events-data.js` ships with `CAMPUSFLOW_EVENTS` empty, plus a ready-to-copy sample event sitting just below it, disabled inside a comment block. Follow the instructions at the top of that file — it's a single comment toggle, not a line-by-line uncomment, so it's hard to get wrong.
4. **Class presets**: `presets-data.js` ships with `CSE-E1` and `CSE-E2` wired into Settings → "Add classes from preset". To add more sections, add a new key to the `CAMPUSFLOW_PRESETS` object in that file (same shape as the existing two) and a matching `<option>` in the `#select-preset` dropdown in `index.html`.

## Run it locally

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```
(A local server is needed for the ID card feature — `fetch()`-based preset loading and PDF rendering behave inconsistently under `file://`.)

## Deploy to GitHub Pages

1. Push this whole folder structure (including `assets/`, `presets/`, and `developer/`) to the root of your repo's `main` branch.
2. **Settings → Pages** → Source: "Deploy from a branch", branch `main`, folder `/ (root)`.
3. Your app is now at `https://yourusername.github.io/your-repo-name/`, and the developer page at `.../developer/`.

## How data is stored

Everything the student enters — classes, sessions, works, completion marks, name, profile picture, ID card PDF and its coordinates, and settings — lives in `localStorage` under the key `campusflow.v1`. Nothing is ever sent anywhere. **Events are the one exception**: they come from `events-data.js`, a file you (the admin) edit and redeploy — every visitor sees the same list, and it isn't stored per-device.

Because the ID card PDF and profile picture are stored as base64 text inside `localStorage`, keep uploaded PDFs reasonably small (a scanned ID under a few MB is fine); very large files may hit the browser's `localStorage` quota (typically 5–10MB per site).

## The digital ID card, explained

- In Settings, uploading a PDF opens a **mapping step**: you tell the app (as % of the page) where the front and back of the card sit on your PDF. A live preview with dashed boxes helps you line them up. Defaults are pre-filled for a standard two-up (front-left, back-right) layout.
- The app renders your PDF client-side using [pdf.js](https://mozilla.github.io/pdf.js/) — no server involved.
- When a student taps "View ID Card" (from the profile panel), the app composites the mapped crop onto `assets/id-card-mockup.png` on a `<canvas>`, then shows it full-screen with a blur/dim backdrop and a slide-down animation. "Flip" quickly re-composites the other side; "Close" reverses the animation.
- **Note on scope**: the "Edit" flow lets you re-map an existing PDF's coordinates or upload a replacement file. Profile pictures use a simpler, fully-automatic 1:1 center-crop with no coordinate step, since there's no second image to align it against.

## Notifications

Browser push notifications require:
- HTTPS (GitHub Pages provides this automatically) or `localhost`
- The user granting the browser's notification permission (triggered when the toggle is flipped on in Settings)
- The tab (or installed PWA) staying open — like all web notifications, they won't fire if the browser is fully closed

## Browser support

Built with vanilla HTML/CSS/JS — works in any modern browser (Chrome, Safari, Firefox, Edge). Uses CSS `:has()` (for the Works "type" radio chips) and `backdrop-filter` (ID card viewer) — both are well-supported in current browsers but degrade gracefully to a plain (non-highlighted / non-blurred) look on very old ones. `localStorage` and the Notifications API are required for full functionality; the app still works without notifications, just without the 15-minute alert.
