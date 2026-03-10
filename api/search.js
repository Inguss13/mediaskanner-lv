export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { query } = req.body || {};
  if (!query) return res.status(400).json({ error: "Query is required" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "API key nav konfigurēta serverī" });

  const today = new Date().toISOString().split("T")[0];

  const prompt = `Tu esi Latvijas mediju meklēšanas sistēma. Šodienas datums: ${today}.

Meklē informāciju par: "${query}" Latvijas medijos.

Izmanto web_search rīku un veic šādus meklēšanas vaicājumus:
1. ${query} site:delfi.lv
2. ${query} site:lsm.lv
3. ${query} site:apollo.lv
4. ${query} Latvija ziņas

Atgriezies TIKAI ar JSON masīvu bez jebkāda cita teksta:
[{"id":1,"type":"article","source":"delfi","sourceName":"Delfi.lv","title":"virsraksts","excerpt":"apraksts latviešu valodā","date":"2026-03-01","dateLabel":"10 dienas atpakaļ","url":"https://delfi.lv/...","timestamps":null,"relevance":80,"lang":"lv"}]

Svarīgi:
- type: article, video, audio vai social
- source: delfi, lsm, apollo, tvnet, jauns, ltv, lr, youtube, social vai other
- lang: lv, ru vai en
- Norādi TIKAI datumus ko redzi avotos — ja nezini, raksti null
- Atgriezies ar 8-15 rezultātiem
- TIKAI JSON — nekāds cits teksts!`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 8000,
        tools: [{ type: "web_search_20250305", name: "web_search" }],
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(response.status).json({ error: err.error?.message || `HTTP ${response.status}` });
    }

    const data = await response.json();
    const text = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");

    let results = [];
    const start = text.indexOf("[");
    const end = text.lastIndexOf("]");
    if (start !== -1 && end !== -1 && end > start) {
      try {
        results = JSON.parse(text.slice(start, end + 1));
        if (!Array.isArray(results)) results = [];
      } catch {
        results = [];
      }
    }

    return res.status(200).json({ results });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
