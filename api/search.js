export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { query } = req.body || {};
  if (!query) return res.status(400).json({ error: "Query is required" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "API key nav konfigurēta" });

  const today = new Date().toISOString().split("T")[0];
  const yyyy = new Date().getFullYear();

  function extractJSON(text) {
    const start = text.indexOf("[");
    const end = text.lastIndexOf("]");
    if (start === -1 || end === -1 || end <= start) return [];
    try {
      const parsed = JSON.parse(text.slice(start, end + 1));
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  }

  async function callAPI(searches) {
    const prompt = `Tu esi Latvijas mediju meklēšanas sistēma. Šodienas datums: ${today}.

Meklē informāciju par: "${query}"

Veic šos web_search meklējumus:
${searches.map((s, i) => `${i + 1}. ${s}`).join("\n")}

Pēc meklēšanas atgriezies TIKAI ar JSON masīvu, bez jebkāda cita teksta:
[{"id":1,"type":"article","source":"delfi","sourceName":"Delfi.lv","title":"raksta virsraksts","excerpt":"īss apraksts latviski","date":"2026-03-01","dateLabel":"Šodien","url":"https://delfi.lv/raksts","relevance":85,"lang":"lv"}]

Lauki: type=article/video/audio/social, source=delfi/lsm/apollo/tvnet/jauns/nra/ltv/lr/tv3/youtube/social/other, date=null ja nezini. Atgriezies ar 5-8 rezultātiem. TIKAI JSON!`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 4000,
        tools: [{ type: "web_search_20250305", name: "web_search" }],
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || `HTTP ${response.status}`);
    }

    const data = await response.json();
    const text = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");
    return extractJSON(text);
  }

  // 2 secīgi izsaukumi — nevis paralēli, lai izvairītos no rate limit
  try {
    const results1 = await callAPI([
      `${query} site:delfi.lv`,
      `${query} site:lsm.lv`,
      `${query} site:apollo.lv`,
    ]);

    const results2 = await callAPI([
      `${query} site:tvnet.lv OR site:jauns.lv`,
      `${query} Latvija LTV TV3 ziņas ${yyyy}`,
    ]);

    const combined = [...results1, ...results2];

    const seen = new Set();
    const unique = combined.filter((r) => {
      if (!r || typeof r !== "object" || !r.title) return false;
      const key = (r.url || r.title).toLowerCase().trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const final = unique
      .map((r, i) => ({ ...r, id: i + 1 }))
      .sort((a, b) => {
        if (a.date && b.date && a.date !== b.date) return b.date.localeCompare(a.date);
        return (b.relevance || 0) - (a.relevance || 0);
      });

    return res.status(200).json({ results: final, total: final.length });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
