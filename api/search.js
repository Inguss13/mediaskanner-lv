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

  const prompt = `Tu esi Latvijas mediju meklēšanas sistēma "MediaSkanner LV". Meklē informāciju par: "${query}"

Izmanto web_search rīku. Veic šādus meklēšanas vaicājumus:
1. "${query} delfi.lv"
2. "${query} lsm.lv"
3. "${query} Latvija"

Pēc meklēšanas atgriezies AR TIKAI šādu JSON masīvu — bez jebkāda cita teksta pirms vai pēc:

[
  {
    "id": 1,
    "type": "article",
    "source": "delfi",
    "sourceName": "Delfi.lv",
    "title": "raksta virsraksts",
    "excerpt": "2-3 teikumi latviešu valodā",
    "date": "2026-03-09",
    "dateLabel": "Šodien",
    "url": "https://...",
    "timestamps": null,
    "relevance": 90,
    "lang": "lv"
  }
]

Pieļaujamās vērtības:
- type: "article", "video", "audio", "social"
- source: "delfi", "lsm", "apollo", "tvnet", "jauns", "ltv", "lr", "youtube", "social"
- lang: "lv", "ru", "en"
- timestamps: null vai [{time:"MM:SS", text:"teksts"}] tikai video/audio

Atgriezies ar 5-8 rezultātiem. TIKAI JSON — nekāds cits teksts!`;

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
