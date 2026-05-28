// Click n' Glide scraper — server-only. Logs into the club portal with
// credentials from env (CNG_EMAIL / CNG_PASSWORD), fetches the per-day
// dashboard, and parses Duty Instructor, Duty Pilot, GFE (Introductory
// Flights) and TMG GFE bookings.

const LOGIN_URL = "https://clicknglide.com/organisation/login.php?lang=en";
const DASHBOARD_BASE = "https://clicknglide.com/organisation/organisation.php";

export type CngGfe = {
  time_text: string | null;
  passenger_name: string | null;
  gfe_type: string | null;
  ref: string | null;
  raw_text: string;
};

export type CngDaySnapshot = {
  date: string; // YYYY-MM-DD
  duty_instructor: string | null;
  duty_pilot: string | null;
  gfes: CngGfe[]; // Introductory Flights (aerotow GFEs etc.)
  tmg_gfes: CngGfe[]; // TMG GFE bookings
  fetched_at: string;
  raw_lengths: { dashboard: number };
};

function parseSetCookie(headers: Headers): Map<string, string> {
  // Cloudflare/Workers exposes set-cookie via .getSetCookie() when available,
  // else fall back to getAll-like behavior.
  const jar = new Map<string, string>();
  const anyHeaders = headers as unknown as { getSetCookie?: () => string[] };
  const list: string[] =
    typeof anyHeaders.getSetCookie === "function" ? anyHeaders.getSetCookie() : [];
  if (list.length === 0) {
    const raw = headers.get("set-cookie");
    if (raw) list.push(raw);
  }
  for (const c of list) {
    const first = c.split(";")[0];
    const eq = first.indexOf("=");
    if (eq > 0) jar.set(first.slice(0, eq).trim(), first.slice(eq + 1).trim());
  }
  return jar;
}

function cookieHeader(jar: Map<string, string>): string {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

async function login(): Promise<Map<string, string>> {
  const email = process.env.CNG_EMAIL;
  const password = process.env.CNG_PASSWORD;
  if (!email || !password) throw new Error("CNG_EMAIL / CNG_PASSWORD not configured");

  // 1) GET login to seed PHPSESSID
  const initRes = await fetch(LOGIN_URL, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; ESGC-Logs-Sync)" },
    redirect: "manual",
  });
  const jar = parseSetCookie(initRes.headers);

  // 2) POST credentials
  const form = new URLSearchParams();
  form.set("email", email);
  form.set("mdp", password);
  form.set("cookie", "on");

  const postRes = await fetch(LOGIN_URL, {
    method: "POST",
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; ESGC-Logs-Sync)",
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookieHeader(jar),
      Referer: LOGIN_URL,
    },
    body: form.toString(),
    redirect: "manual",
  });
  for (const [k, v] of parseSetCookie(postRes.headers)) jar.set(k, v);

  // Follow any redirect (sets more cookies)
  if (postRes.status >= 300 && postRes.status < 400) {
    const loc = postRes.headers.get("location");
    if (loc) {
      const url = new URL(loc, LOGIN_URL).toString();
      const r2 = await fetch(url, {
        headers: { Cookie: cookieHeader(jar), "User-Agent": "Mozilla/5.0" },
        redirect: "manual",
      });
      for (const [k, v] of parseSetCookie(r2.headers)) jar.set(k, v);
    }
  }
  return jar;
}

async function fetchDashboard(jar: Map<string, string>, date: string): Promise<string> {
  const [y, m] = date.split("-");
  const url = new URL(DASHBOARD_BASE);
  url.searchParams.set("lang", "en");
  url.searchParams.set("mois_calendrier", `${y}-${m}`);
  url.searchParams.set("jour_courant", date);
  url.searchParams.set("actif", "0");
  const res = await fetch(url.toString(), {
    headers: { Cookie: cookieHeader(jar), "User-Agent": "Mozilla/5.0" },
  });
  if (!res.ok) throw new Error(`CnG dashboard HTTP ${res.status}`);
  const html = await res.text();
  // If we got bounced to the login page, the body is tiny and contains the
  // login form rather than the dashboard.
  if (html.length < 5000 || /<form[^>]*id="connexion"/i.test(html)) {
    throw new Error("CnG login session was not established (received login page).");
  }
  return html;
}

// Extracts the inner HTML of the `<div class="org-box-main">…</div>` that
// follows a `<h3>{title}…</h3>` heading. Returns null if not found.
function extractBoxAfter(html: string, title: string): string | null {
  // Escape regex specials in the title
  const t = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `<h3>\\s*${t}[^<]*</h3>[\\s\\S]*?<div class="org-box-main">([\\s\\S]*?)</div>\\s*</div>`,
    "i",
  );
  const m = html.match(re);
  return m ? m[1] : null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function extractMemberNames(boxHtml: string): string[] {
  // <span class='nom_membre' … id_membre='5'>James Warren</span>
  const re = /<span[^>]*class=['"]nom_membre['"][^>]*>([^<]+)<\/span>/gi;
  const names: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(boxHtml))) {
    const n = decodeEntities(m[1]).trim();
    if (n && n !== "-") names.push(n);
  }
  return [...new Set(names)];
}

function parseGfeLine(raw: string): CngGfe {
  // Examples:
  //   "16:00 - ** Aerobatic Flight** Dionne McGrath - 25-11355 - 07503 540249"
  //   "14:00 - Gerald Gatton - Aerotow GFE - 26-11417 - 07542165607"
  //   "10.30 - Hilton - Ultimate GFE - 07762701882"
  const text = raw.trim();
  // Time at the start (HH:MM or HH.MM)
  const timeMatch = text.match(/^(\d{1,2}[:.]\d{2})\s*-?\s*/);
  const time_text = timeMatch ? timeMatch[1].replace(".", ":") : null;
  const afterTime = timeMatch ? text.slice(timeMatch[0].length) : text;

  // Split on " - " separators
  const parts = afterTime.split(/\s+-\s+/).map((p) => p.trim()).filter(Boolean);
  // Reference looks like "25-11355" / "26-11417"
  const refIdx = parts.findIndex((p) => /^\d{2}-\d{3,6}$/.test(p));
  const ref = refIdx >= 0 ? parts[refIdx] : null;
  // GFE type contains "GFE" or "Flight"
  const typeIdx = parts.findIndex((p) => /GFE|Flight/i.test(p));
  const gfe_type = typeIdx >= 0 ? parts[typeIdx] : null;
  // Passenger = first part that isn't ref/type/phone-only
  const isPhone = (p: string) => /^[\d\s+()-]{7,}$/.test(p);
  const passenger_name =
    parts.find((p, i) => i !== refIdx && i !== typeIdx && !isPhone(p) && p.length > 1) ?? null;

  return { time_text, passenger_name, gfe_type, ref, raw_text: text };
}

function parseGfeBox(boxHtml: string | null): CngGfe[] {
  if (!boxHtml) return [];
  // Each booking is rendered as `<div class=''>- TEXT</div>`
  const re = /<div class=['"]['"]>\s*-?\s*([^<]+)<\/div>/gi;
  const out: CngGfe[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(boxHtml))) {
    const raw = decodeEntities(m[1]).trim();
    if (!raw || raw === "-") continue;
    out.push(parseGfeLine(raw));
  }
  return out;
}

export function parseDashboard(html: string, date: string): CngDaySnapshot {
  const diBox = extractBoxAfter(html, "Duty Instructor");
  const dpBox = extractBoxAfter(html, "Duty Pilot");
  const ifBox = extractBoxAfter(html, "Introductory Flights");
  const tmgBox = extractBoxAfter(html, "TMG GFEs");

  const di = diBox ? extractMemberNames(diBox).join(", ") || null : null;
  const dp = dpBox ? extractMemberNames(dpBox).join(", ") || null : null;

  return {
    date,
    duty_instructor: di,
    duty_pilot: dp,
    gfes: parseGfeBox(ifBox),
    tmg_gfes: parseGfeBox(tmgBox),
    fetched_at: new Date().toISOString(),
    raw_lengths: { dashboard: html.length },
  };
}

export async function fetchCngDay(date: string): Promise<CngDaySnapshot> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("date must be YYYY-MM-DD");
  const jar = await login();
  const html = await fetchDashboard(jar, date);
  return parseDashboard(html, date);
}
