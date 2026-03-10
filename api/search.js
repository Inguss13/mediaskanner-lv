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
  const yyyy = new Date().getFullYear();
  const mm = String(new Date().getMonth() + 1).padStart(2, "0");

  function extractJSON(text) {
    const start = text.indexOf("[");
    const end = text.lastIndexOf("]");
    if (start === -1 || end === -1 || end <= start) return [];
    try {
      const parsed = JSON.parse(text.slice(start, end + 1));
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  }

  async function callAPI(searches, sourceHint) {
    const prompt = `Tu esi Latvijas mediju meklēšanas sistēma. Šodienas datums: ${today}.

Meklē informāciju par: "${query}"
Avotu grupa: ${sourceHint}

Izmanto web_search rīku un veic VISUS šos vaicājumus:
${searches.map((s, i) => `${i + 1}. ${s}`).join("\n")}

Atgriezies TIKAI ar JSON masīvu bez jebkāda cita teksta:
[{"id":1,"type":"article","source":"delfi","sourceName":"Delfi.lv","title":"virsraksts","excerpt":"apraksts latviešu valodā","date":"2026-03-01","dateLabel":"10 dienas atpakaļ","url":"https://delfi.lv/...","timestamps":null,"relevance":80,"lang":"lv"}]

Noteikumi:
- type: article, video, audio vai social
- source: delfi, lsm, apollo, tvnet, jauns, nra, ir, ltv, lr, tv3, retv, radio_skonto, star_fm, youtube, social, other
- sourceName: pilns avota nosaukums
- lang: lv, ru vai en
- date: TIKAI datums ko redzi avotā — ja nezini raksti null
- dateLabel: "Šodien", "Vakar", "X dienas atpakaļ", "X nedēļas atpakaļ"
- Atgriezies ar 8-12 rezultātiem. TIKAI JSON!`;

    try {
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
      if (!response.ok) return [];
      const data = await response.json();
      const text = (data.content || [])
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("");
      return extractJSON(text);
    } catch { return []; }
  }

  // 3 paralēli izsaukumi — sabalansēts starp kvalitāti un izmaksām
  const groups = [
    {
      hint: "Ziņu portāli",
      searches: [
        `${query} site:delfi.lv`,
        `${query} site:lsm.lv`,
        `${query} site:apollo.lv`,
        `${query} site:tvnet.lv`,
        `${query} site:jauns.lv`,
        `${query} site:nra.lv`,
      ]
    },
    {
      hint: "TV, Radio un video",
      searches: [
        `${query} site:ltv.lv OR site:replay.lsm.lv`,
        `${query} site:tv3.lv OR site:play.tv3.lv`,
        `${query} Re:TV TV3 LTV ziņas Latvija ${yyyy}`,
        `${query} Latvijas Radio LR1 LR2 Radio Skonto ${yyyy}`,
        `${query} youtube Latvija ${yyyy}`,
      ]
    },
    {
      hint: "Vispārēja un sociālie tīkli",
      searches: [
        `${query} Latvija ziņas ${yyyy}-${mm}`,
        `${query} Latvia news ${yyyy}`,
        `${query} Latvija facebook twitter instagram ${yyyy}`,
        `${query} site:ir.lv OR site:pietiek.com`,
      ]
    },
  ];

  try {
    const allResults = await Promise.all(
      groups.map((g) => callAPI(g.searches, g.hint))
    );
    const combined = allResults.flat();

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
