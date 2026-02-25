
# Geography Trainer V2 — GitHub Pages bundle

**What this contains**
- index.html (landing), quiz.html (game), leaderboards.html (overview), verify.html (SVG checker)
- app_v2.js (gameplay), data_v2.js (generated from Excel)
- styles.css, service-worker.js, manifest.webmanifest, icons

**What you provide**
- A folder at repo root named `svg/` with your full SVG set. Filenames must match **Col A** (lowercased) + `.svg`.

**Deploy**
1. Upload all files in this zip to your repo root (keep `svg/` alongside).
2. Enable GitHub Pages for the repo (root). Open the site.
3. Visit `/verify.html` to check for missing SVGs (should all be OK).
4. Open `/` (landing) → pick a mode. The SW will cache core pages and SVGs.

**Leaderboards**
- V2 wipes any old leaderboards on first load and uses a new namespace (`gt.v2.lb.<mode>`).

**Answers**
- Case-insensitive only. All alternative spellings must be provided in the Excel (Cols C and G).

**APK later**
- This PWA structure can be wrapped via Capacitor/Cordova when ready.
