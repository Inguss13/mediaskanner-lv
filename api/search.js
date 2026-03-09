export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { query, dateFilter = "month" } = req.body || {};
  if (!query) return res.status(400).json({ error: "Query is required" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "API key nav konfigurēta serverī" });

  const now = new Date();
  const today = now.toISOString().split("T")[0];
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yyyy = now.getFullYear();

  // Izvelk JSON masīvu no teksta — pareizi apstrādā ligzdotus masīvus
  function extractJSON(text) {
    const start = text.indexOf("[");
    if (start === -1) return [];
    let depth = 0;
    let end = -1;
    for (let i = start; i < text.length; i++) {
      if (text[i] === "[" || text[i] === "{") depth++;
      else if (text[i] === "]" || text[i] === "}") {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    if (end === -1) return [];
    try {
      const parsed = JSON.parse(text.slice(start, end + 1));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  const searchGroups = [
    {
      searches: [
        `${query} Latvija ${yyyy}-${mm}`,
        `${query} Latvia news ${yyyy}`,
        `${query} Latvija šodien ${yyyy}`,
      ]
    },
    {
      searches: [
        `${query} site:delfi.lv`,
        `${query} site:lsm.lv`,
        `${query} site:apollo.lv`,
      ]
    },
    {
      searches: [
        `${query} site:tvnet.lv`,
        `${query} site:jauns.lv`,
        `${query} site:nra.lv OR site:ir.lv`,
      ]
    },
    {
      searches: [
        `${query} Latvijas televīzija LTV ${yyyy}`,
        `${query} Latvijas radio ${yyyy}`,
        `${query} site:replay.lsm.lv`,
      ]
    },
    {
      searches: [
        `${query} youtube latvia ${yyyy}`,
        `${query} Latvija facebook ${yyyy}-${mm}`,
        `${query} Latvija instagram tiktok ${yyyy}`,
      ]
    }
  ];

  const makePrompt = (group) => `Tu esi Latvijas mediju meklēšanas sistēma. Šodienas datums: ${today}.

Meklē rezultātus par: "${query}"

Izmanto web_search un veic šos vaicājumus:
${group.searches.map((s, i) => `${i + 1}. ${s}`).join("\n")}

Pēc meklēšanas atgriezies TIKAI ar JSON masīvu. Nekāds cits teksts — tikai JSON.
Formāts:
[
  {
    "id": 1,
    "type": "article",
    "source": "delfi",
    "sourceName": "Delfi.lv",
    "title": "Raksta virsraksts",
    "excerpt": "2-3 teikumi par saturu latviešu valodā.",
    "date": "${today}",
    "dateLabel": "Šodien",
    "url": "https://www.delfi.lv/raksts",
    "timestamps": null,
    "relevance": 85,
    "lang": "lv"
  }
]

Pieļaujamās vērtības:
- type: "article", "video", "audio", "social"
- source: "delfi", "lsm", "apollo", "tvnet", "jauns", "ltv", "lr", "youtube", "social", "other"
- lang: "lv", "ru", "en"
- timestamps: null vai [{"time":"04:32","text":"konteksts"}] — tikai video un audio
- dateLabel: "Šodien", "Vakar", "3 dienas atpakaļ", "1 nedēļa atpakaļ"

Atgriezies ar 8-12 rezultātiem. Prioritizē jaunākos. TIKAI JSON MASĪVS — nekas cits!`;

  const callAPI = async (group) => {
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
          messages: [{ role: "user", content: makePrompt(group) }],
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        console.error("API error:", err);
        return [];
      }

      const data = await response.json();
      const text = (data.content || [])
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("");

      return extractJSON(text);

    } catch (err) {
      console.error("Fetch error:", err.message);
      return [];
    }
  };

  try {
    // Paralēli visi 5 izsaukumi
    const allResults = await Promise.all(searchGroups.map(callAPI));
    const combined = allResults.flat();

    // Noņem dublikātus pēc URL + virsraksta
    const seen = new Set();
    const unique = combined.filter((r) => {
      if (!r || typeof r !== "object") return false;
      const key = (r.url || "") + "|" + (r.title || "");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Datumu filtrēšana serverī
    const cutoff = new Date(now);
    if (dateFilter === "day")   cutoff.setDate(now.getDate() - 1);
    else if (dateFilter === "week")  cutoff.setDate(now.getDate() - 7);
    else if (dateFilter === "month") cutoff.setMonth(now.getMonth() - 1);
    else if (dateFilter === "year")  cutoff.setFullYear(now.getFullYear() - 1);
    const cutoffStr = cutoff.toISOString().split("T")[0];

    const filtered = dateFilter === "all"
      ? unique
      : unique.filter((r) => !r.date || r.date >= cutoffStr);

    // Sakārto — jaunākie pirmie
    const final = filtered
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
