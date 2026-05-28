export function renderErrorPage(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>ESGC Logs — Something went wrong</title><style>
  :root{color-scheme:light dark}
  html,body{margin:0;height:100%;font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#0b1220;color:#e6edf7}
  .wrap{min-height:100%;display:flex;align-items:center;justify-content:center;padding:24px}
  .card{max-width:480px;width:100%;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:16px;padding:28px;text-align:center;backdrop-filter:blur(12px)}
  h1{font-size:22px;margin:0 0 8px}
  p{color:#a5b1c2;margin:0 0 20px;line-height:1.5}
  .row{display:flex;gap:10px;justify-content:center;flex-wrap:wrap}
  button,a.btn{appearance:none;border:1px solid rgba(255,255,255,0.18);background:rgba(255,255,255,0.06);color:#e6edf7;padding:10px 16px;border-radius:10px;font-size:14px;cursor:pointer;text-decoration:none;font-weight:500}
  button.primary{background:#3b82f6;border-color:#3b82f6;color:#fff}
  </style></head><body><div class="wrap"><div class="card"><h1>Something went wrong</h1><p>The page failed to load. Refresh to try again, or head back to the home page.</p><div class="row"><button class="primary" onclick="location.reload()">Refresh</button><a class="btn" href="/">Go home</a></div></div></div></body></html>`;
}
