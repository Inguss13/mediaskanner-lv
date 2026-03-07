export default async function handler(req, res) {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { query } = req.body || {};
  if (!query) return res.status(400).json({ error: "Query is required" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "API key nav konfigurēta serverī" });

  const prompt = `Tu esi Latvijas mediju meklēšanas sistēma "MediaSkanner LV".

Lietotājs meklē: "${query}"

Izmanto web_search rīku lai atrastu REĀLUS, aktuālus rezultātus par šo tēmu no Latvijas medijiem.
Veic vairākus meklēšanas vaicājumus:
1. "${query} site:delfi.lv OR site:lsm.lv OR site:apollo.lv"
2. "${query} Latvija ziņas"
3. "${query} Latvia"

Pēc meklēšanas atgriezies ar JSON masīvu. Katrs elements:
{
  "id": unikāls skaitlis,
  "type": "article" vai "video" vai "audio" vai "social",
  "source": "delfi" vai "lsm" vai "apollo" vai "tvnet" vai "jauns" vai "ltv" vai "lr" vai "youtube" vai "social",
  "sourceName": "Delfi.lv" u.c.,
  "title": raksta vai video virsraksts,
  "excerpt": 2-3 teikumi par saturu latviešu valodā,
  "date": "YYYY-MM-DD",
  "dateLabel": "Šodien" vai "Vakar" vai "3 dienas atpakaļ" u.c.,
  "url": tiešā saite uz saturu,
  "timestamps": null vai [{time:"MM:SS", text:"...konteksts..."}] tikai video/audio,
  "relevance": 1-100,
  "lang": "lv" vai "ru" vai "en"
}

SVARĪGI: Atgriezies TIKAI ar derīgu JSON masīvu, bez papildus teksta vai markdown formatējuma. Sniedz 6-12 rezultātus.`;

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
        max_tokens: 1000,
        tools: [{ type: "web_search_20250305", name: "web_search" }],
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(response.status).json({ error: err.error?.message || `API kļūda ${response.status}` });
    }

    const data = await response.json();
    const text = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");

    const match = text.match(/\[[\s\S]*\]/);
    let results = [];
    if (match) {
      try { results = JSON.parse(match[0]); } catch { results = []; }
    }

    return res.status(200).json({ results });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
