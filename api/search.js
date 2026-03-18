export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { query, dateFilter } = req.body || {};
  if (!query) return res.status(400).json({ error: "Query required" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "No API key" });

  const today = new Date().toISOString().split("T")[0];
  const yyyy = new Date().getFullYear();
  const mm = String(new Date().getMonth() + 1).padStart(2, "0");

  // Build date constraint for searches
  const dateHint = dateFilter === "day"   ? `after:${yyyy}-${mm}-${String(new Date().getDate() - 1).padStart(2,"0")}`
                 : dateFilter === "week"  ? `after:${yyyy}-${mm}-${String(Math.max(1, new Date().getDate() - 7)).padStart(2,"0")}`
                 : dateFilter === "month" ? `after:${yyyy}-${String(new Date().getMonth()).padStart(2,"0")}-01`
                 : dateFilter === "year"  ? `after:${yyyy}-01-01`
                 : "";

  const prompt = `Šodienas datums: ${today}. Meklē konkrētus rakstus, video un audio par: "${query}"

Veic VISUS šos web_search meklējumus (katru atsevišķi):
1. "${query}" site:delfi.lv ${dateHint}
2. "${query}" site:lsm.lv ${dateHint}
3. "${query}" site:apollo.lv ${dateHint}
4. "${query}" site:tvnet.lv OR site:jauns.lv ${dateHint}
5. "${query}" site:nra.lv OR site:ir.lv ${dateHint}
6. "${query}" LTV video sižets site:ltv.lv OR site:replay.lsm.lv ${dateHint}
7. "${query}" TV3 video site:tv3play.lv ${dateHint}

OBLIGĀTI NOTEIKUMI — katram rezultātam PIRMS iekļaušanas pārbaudi:

✅ PIEŅEM tikai:
- Konkrētu rakstu lapas (URL satur raksta ID, slug vai datumu: /12345/, /raksta-nosaukums/, /2026/03/)
- Konkrētu video lapas (YouTube video URL ar ?v=..., LTV/TV3 atsevišķa sižeta lapa)
- Konkrētu audio ierakstu lapas (LSM atsevišķa raidījuma lapa)

❌ IZMET — neatgriezties ar šādiem URL:
- Sadaļu/kategoriju lapas: /sports/, /ekonomika/, /politika/, /kultura/, /zinas/ utt.
- Tagu lapas: /tags/, /tema/, /birka/
- Mājaslapas: delfi.lv, lsm.lv (bez raksta ceļa)
- Meklēšanas lapas: /search/, /meklet/
- Lapas bez konkrēta raksta/video nosaukuma

PAR DATUMIEM — KRITISKS NOTEIKUMS:
- Norādi TIKAI datumu ko faktiski redzi meklēšanas rezultātā (metadatos, raksta galvenē, URL)
- Ja URL satur datumu (piemēram /2026/03/15/), izmanto to
- Ja datums nav redzams — liec null, NEKAD neizdomā datumu
- Datums formātā: "2026-03-15"

PAR LAIKSPIEDOLIEM:
- Iekļauj TIKAI ja YouTube aprakstā vai LSM/LTV lapā ir tiešām redzami laikspiedoli
- Ja nav — "timestamps": null (NEIZDOMĀ!)

Atgriezies TIKAI ar JSON masīvu, jaunākie rezultāti pirmie:
[{
  "id": 1,
  "type": "article",
  "source": "delfi",
  "sourceName": "Delfi.lv",
  "title": "Konkrēts raksta virsraksts",
  "excerpt": "Īss apraksts latviešu valodā no raksta satura",
  "date": "2026-03-18",
  "dateLabel": "Šodien",
  "url": "https://www.delfi.lv/raksts/konkrets-raksts/12345",
  "relevance": 90,
  "lang": "lv",
  "timestamps": null
}]

type: article / video / audio / social
source: delfi / lsm / apollo / tvnet / jauns / nra / ir / ltv / lr / tv3 / youtube / instagram / facebook / social / other
lang: lv / ru / en

Atgriezies ar 10-15 KONKRĒTIEM rakstiem/video, jaunākie pirmie pēc datuma. TIKAI JSON!`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 8000,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    return res.status(500).json({ error: err.error?.message || `HTTP ${response.status}` });
  }

  const data = await response.json();
  const text = (data.content || [])
    .filter(b => b.type === "text")
    .map(b => b.text)
    .join("");

  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");

  if (start === -1 || end === -1) {
    return res.status(200).json({ results: [], total: 0 });
  }

  let results = [];
  try {
    results = JSON.parse(text.slice(start, end + 1));
    if (!Array.isArray(results)) results = [];
  } catch {
    return res.status(200).json({ results: [], total: 0 });
  }

  // Server-side filter: reject section/category/tag pages
  const SECTION_PATTERN = /\/(sports?|ekonomika|politika|kultura?|zinas|tags?|tema|birka|kategorija|section|search|meklet|feed|rss)\/?(\?.*)?$/i;

  function isValidContentUrl(url) {
    if (!url) return false;
    try {
      const u = new URL(url);
      // Must have a meaningful path (not just domain or top-level section)
      const path = u.pathname.replace(/\/$/, "");
      if (!path || path === "" || path.split("/").filter(Boolean).length < 2) return false;
      if (SECTION_PATTERN.test(path)) return false;
      return true;
    } catch {
      return true; // if URL can't be parsed, let it through
    }
  }

  function makeDateLabel(dateStr) {
    if (!dateStr) return null;
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return null;
    const diffDays = Math.floor((new Date() - d) / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return "Šodien";
    if (diffDays === 1) return "Vakar";
    if (diffDays < 7)  return `${diffDays} dienas atpakaļ`;
    if (diffDays < 14) return "1 nedēļa atpakaļ";
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} nedēļas atpakaļ`;
    if (diffDays < 60) return "1 mēnesis atpakaļ";
    if (diffDays < 365) return `${Math.floor(diffDays / 30)} mēneši atpakaļ`;
    return `${Math.floor(diffDays / 365)} gads atpakaļ`;
  }

  const seen = new Set();
  const unique = results
    .filter(r => {
      if (!r?.title) return false;
      if (!isValidContentUrl(r.url)) return false;
      const key = (r.url || r.title).toLowerCase().trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((r, i) => ({
      ...r,
      id: i + 1,
      dateLabel: r.date ? (makeDateLabel(r.date) || r.dateLabel) : r.dateLabel,
    }))
    .sort((a, b) => {
      if (a.date && b.date && a.date !== b.date) return b.date.localeCompare(a.date);
      if (a.date && !b.date) return -1;
      if (!a.date && b.date) return 1;
      return (b.relevance || 0) - (a.relevance || 0);
    });

  return res.status(200).json({ results: unique, total: unique.length });
}
