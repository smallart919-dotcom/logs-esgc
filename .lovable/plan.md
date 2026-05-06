## Make ESGC Logs installable (PWA-lite, no service worker)

### Steps

1. **Generate icon PNGs** from the existing `public/favicon.png` logo:
   - `public/icon-192.png` (192×192) — Android home screen
   - `public/icon-512.png` (512×512) — Android splash / high-res
   - `public/apple-touch-icon.png` (180×180) — iOS home screen
   Use ImageMagick to resize with transparent padding so the logo isn't cropped.

2. **Create `public/manifest.json`**:
   ```json
   {
     "name": "ESGC Logs",
     "short_name": "ESGC",
     "description": "East Sussex Gliding Club daily flight log",
     "start_url": "/",
     "display": "standalone",
     "background_color": "#ffffff",
     "theme_color": "#ffffff",
     "icons": [
       { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any maskable" },
       { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable" }
     ]
   }
   ```

3. **Update `src/routes/__root.tsx`** `head()` to add:
   - `<link rel="manifest" href="/manifest.json">`
   - `<link rel="apple-touch-icon" href="/apple-touch-icon.png">`
   - `<meta name="theme-color" content="#ffffff">`
   - `<meta name="apple-mobile-web-app-capable" content="yes">`
   - `<meta name="apple-mobile-web-app-title" content="ESGC Logs">`
   - `<meta name="apple-mobile-web-app-status-bar-style" content="default">`

4. **No service worker** — per Lovable guidance, manifest-only is enough for installability and avoids preview-iframe issues.

5. **Publish** — frontend changes need a Publish click to go live on `logs-esgc.lovable.app` before install will work on devices.

### After publishing
- iOS: Safari → Share → Add to Home Screen
- Android: Chrome → Install app prompt or ⋮ menu → Install
- Desktop: address-bar install icon in Chrome/Edge
