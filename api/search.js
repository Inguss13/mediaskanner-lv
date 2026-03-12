export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { query } = req.body || {};
  if (!query) return res.status(400).json({ error: "Query required" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "No API key" });

  const today = new Date().toISOString().split("T")[0];

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 5000,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      messages: [{
        role: "user",
        content: `Šodienas datums: ${today}. Meklē "${query}" Latvijas medijos.

Veic 4 web_search meklējumus:
1. ${query} site:delfi.lv
2. ${query} site:lsm.lv OR site:apollo.lv
3. ${query} site:tvnet.lv OR site:jauns.lv
4. ${query} Latvija ziņas

Atgriezies TIKAI ar JSON masīvu (bez cita teksta):
[{"id":1,"type":"article","source":"delfi","sourceName":"Delfi.lv","title":"...","excerpt":"...","date":"2026-03-12","dateLabel":"Šodien","url":"https://delfi.lv/...","relevance":90,"lang":"lv"}]

Pieņemamie source vērtības: delfi, lsm, apollo, tvnet, jauns, nra, ir, ltv, lr, tv3, youtube, social, other
Ja datums nav zināms, raksti null. Atgriezies ar 8-15 rezultātiem no dažādiem avotiem.`
      }]
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

  const seen = new Set();
  const unique = results.filter(r => {
    if (!r?.title) return false;
    const key = (r.url || r.title).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((r, i) => ({ ...r, id: i + 1 }))
    .sort((a, b) => {
      if (a.date && b.date) return b.date.localeCompare(a.date);
      return (b.relevance || 0) - (a.relevance || 0);
    });

  return res.status(200).json({ results: unique, total: unique.length });
}
