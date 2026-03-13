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
  const yyyy = new Date().getFullYear();

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 6000,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      messages: [{
        role: "user",
        content: `Šodienas datums: ${today}. Meklē "${query}" Latvijas mediju telpā.

Veic VISUS šos 6 web_search meklējumus:
1. ${query} site:delfi.lv OR site:apollo.lv OR site:tvnet.lv
2. ${query} site:lsm.lv OR site:jauns.lv OR site:nra.lv
3. ${query} LTV sižets video ${yyyy} site:ltv.lv OR site:replay.lsm.lv
4. ${query} TV3 video sižets ${yyyy} site:tv3play.lv OR site:tv3.lv
5. ${query} youtube.com Latvija ${yyyy}
6. ${query} instagram.com OR facebook.com Latvija ${yyyy}

SVARĪGI par laikspiedoliem (timestamps):
- Ja YouTube video aprakstā vai lapā ir redzami laikspiedoli (piemēram "03:24 - tēma"), iekļauj tos laukā "timestamps"
- Ja LSM/LTV lapā ir norādīts konkrēts laiks kad sākas tēma, iekļauj to
- Ja laikspiedoli NAV atrasti — raksti timestamps: null (NEIZDOMĀ!)

Atgriezies TIKAI ar JSON masīvu:
[{
  "id": 1,
  "type": "video",
  "source": "ltv",
  "sourceName": "LTV",
  "title": "...",
  "excerpt": "...",
  "date": "${today}",
  "dateLabel": "Šodien",
  "url": "https://...",
  "relevance": 90,
  "lang": "lv",
  "timestamps": [
    {"time": "03:24", "text": "Tēmas apraksts"},
    {"time": "07:15", "text": "Vēl viena daļa"}
  ]
}]

Ja laikspiedoli nav atrasti: "timestamps": null
type: article/video/audio/social
source: delfi/lsm/apollo/tvnet/jauns/nra/ir/ltv/lr/tv3/youtube/instagram/facebook/social/other
Atgriezies ar 10-15 rezultātiem no dažādiem avotiem. TIKAI JSON!`
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
  const unique = results
    .filter(r => {
      if (!r?.title) return false;
      const key = (r.url || r.title).toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((r, i) => ({ ...r, id: i + 1 }))
    .sort((a, b) => {
      if (a.date && b.date) return b.date.localeCompare(a.date);
      return (b.relevance || 0) - (a.relevance || 0);
    });

  return res.status(200).json({ results: unique, total: unique.length });
}
