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

  try {
    const prompt = `Tu esi Latvijas mediju meklēšanas sistēma. Šodienas datums: ${today}.

Meklē informāciju par: "${query}" Latvijas medijos.

Izmanto web_search un meklē:
1. ${query} site:delfi.lv
2. ${query} site:lsm.lv
3. ${query} Latvija ziņas

Atgriezies TIKAI ar JSON masīvu:
[{"id":1,"type":"article","source":"delfi","sourceName":"Delfi.lv","title":"...","excerpt":"...","date":null,"dateLabel":"Šodien","url":"https://...","relevance":85,"lang":"lv"}]

TIKAI JSON bez cita teksta!`;

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

    const data = await response.json();

    // DEBUG — atgriežam visu raw atbildi lai redzam kas notiek
    if (!response.ok) {
      return res.status(200).json({ debug: true, error: data, results: [], total: 0 });
    }

    const allBlocks = data.content || [];
    const textBlocks = allBlocks.filter(b => b.type === "text").map(b => b.text);
    const fullText = textBlocks.join("");

    const start = fullText.indexOf("[");
    const end = fullText.lastIndexOf("]");
    let results = [];

    if (start !== -1 && end !== -1 && end > start) {
      try {
        results = JSON.parse(fullText.slice(start, end + 1));
      } catch(e) {
        return res.status(200).json({ 
          debug: true, 
          parseError: e.message,
          rawText: fullText.slice(0, 500),
          results: [], 
          total: 0 
        });
      }
    }

    return res.status(200).json({ 
      debug: true,
      blockTypes: allBlocks.map(b => b.type),
      textLength: fullText.length,
      foundBrackets: start !== -1,
      results: Array.isArray(results) ? results : [],
      total: Array.isArray(results) ? results.length : 0
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
