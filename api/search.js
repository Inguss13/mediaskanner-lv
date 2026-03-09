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

  // Aprēķina datumu robežas
  const cutoffDate = new Date(now);
  if (dateFilter === "day")   cutoffDate.setDate(now.getDate() - 1);
  else if (dateFilter === "week")  cutoffDate.setDate(now.getDate() - 7);
  else if (dateFilter === "month") cutoffDate.setMonth(now.getMonth() - 1);
  else if (dateFilter === "year")  cutoffDate.setFullYear(now.getFullYear() - 1);
  else cutoffDate.setFullYear(2000); // "all" — viss

  const cutoffStr = cutoffDate.toISOString().split("T")[0];

  // Mēneša un gada string priekš vaicājumiem
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yyyy = now.getFullYear();
  const prevMM = String(now.getMonth() === 0 ? 12 : now.getMonth()).padStart(2, "0");
  const prevYYYY = now.getMonth() === 0 ? yyyy - 1 : yyyy;

  const dateHint = dateFilter === "day"
    ? `${yyyy}-${mm}-${String(now.getDate()).padStart(2,"0")}`
    : dateFilter === "week"
    ? `${yyyy} ${mm}`
    : `${yyyy}-${mm} VAI ${prevYYYY}-${prevMM}`;

  const searchGroups = [
    {
      searches: [
        `${query} Latvija ${yyyy}-${mm}`,
        `${query} Latvia ${yyyy}-${mm}`,
        `${query} Latvija šodien ${yyyy}`,
      ]
    },
    {
      searches: [
        `${query} site:delfi.lv after:${cutoffStr}`,
        `${query} site:lsm.lv after:${cutoffStr}`,
        `${query} site:apollo.lv after:${cutoffStr}`,
      ]
    },
    {
      searches: [
        `${query} site:tvnet.lv after:${cutoffStr}`,
        `${query} site:jauns.lv after:${cutoffStr}`,
        `${query} site:nra.lv OR site:ir.lv after:${cutoffStr}`,
      ]
    },
    {
      searches: [
        `${query} Latvijas televīzija LTV ${yyyy}`,
        `${query} Latvijas radio LR ${yyyy}`,
        `${query} site:replay.lsm.lv after:${cutoffStr}`,
      ]
    },
    {
      searches: [
        `${query} youtube latvia ${yyyy}-${mm}`,
        `${query} Latvija facebook twitter ${yyyy}-${mm}`,
        `${query} Latvija instagram tiktok ${yyyy}`,
      ]
    }
  ];

  const makePrompt = (group) => `Tu esi Latvijas mediju meklēšanas sistēma. Šodienas datums: ${today}.

Meklē rezultātus par: "${query}"
SVARĪGI: Atgriezies TIKAI ar rezultātiem kas publicēti PĒC ${cutoffStr}. Vecākus rezultātus IGNORĒ.

Izmanto web_search un veic šos vaicājumus:
${group.searches.map((s, i) => `${i + 1}. ${s}`).join("\n")}

Ja meklēšana neatgriež jaunus rezultātus (pēc ${cutoffStr}), raksti tukšu masīvu: []

Atgriezies TIKAI ar JSON masīvu:
[{"id":1,"type":"article","source":"delfi","sourceName":"Delfi.lv","title":"virsraksts","excerpt":"2-3 teikumi latviešu valodā","date":"${today}","dateLabel":"Šodien","url":"https://...","timestamps":null,"relevance":85,"lang":"lv"}]

Noteikumi:
- type: "article","video","audio","social"
- source: "delfi","lsm","apollo","tvnet","jauns","ltv","lr","youtube","social","other"
- lang: "lv","ru","en"
- timestamps: null vai [{time:"MM:SS",text:"..."}] tikai video/audio
- dateLabel: "Šodien","Vakar","X dienas atpakaļ","X nedēļas atpakaļ"
- date: OBLIGĀTI precīzs datums formātā YYYY-MM-DD — ja nezini precīzi, norādi aptuveni
- NEIEKĻAUJ rezultātus kas vecāki par ${cutoffStr}

Atgriezies ar 8-12 jaunākajiem rezultātiem. TIKAI JSON!`;

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

      if (!response.ok) return [];
      const data = await response.json();
      const text = (data.content || [])
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("");

      const match = text.match(/\[[\s\S]*?\]/);
      if (!match) return [];
      try { return JSON.parse(match[0]); } catch { return []; }
    } catch {
      return [];
    }
  };

  try {
    const allResults = await Promise.all(searchGroups.map(callAPI));
    const combined = allResults.flat();

    // Noņem dublikātus
    const seen = new Set();
    const unique = combined.filter((r) => {
      const key = (r.url || "") + (r.title || "");
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Filtrē pēc datuma serverī arī
    const filtered = unique.filter((r) => {
      if (dateFilter === "all" || !r.date) return true;
      return r.date >= cutoffStr;
    });

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
