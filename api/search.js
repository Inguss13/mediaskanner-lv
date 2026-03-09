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

  // 5 paralēlas meklēšanas grupas — katra ar plašu pārklājumu
  const searchGroups = [
    {
      searches: [
        `${query} Latvija jaunākās ziņas 2026`,
        `${query} Latvia latest news 2026`,
        `${query} Latvija šodien`,
      ]
    },
    {
      searches: [
        `${query} delfi apollo lsm latvija`,
        `${query} site:delfi.lv OR site:lsm.lv OR site:apollo.lv OR site:tvnet.lv`,
        `${query} site:jauns.lv OR site:nra.lv OR site:ir.lv OR site:skaties.lv`,
      ]
    },
    {
      searches: [
        `${query} Latvijas televīzija LTV raidījums`,
        `${query} Latvijas Radio LR podkāsts`,
        `${query} site:ltv.lv OR site:lr.lv OR site:replay.lsm.lv`,
      ]
    },
    {
      searches: [
        `${query} youtube latvija latvieši`,
        `${query} youtube latvia channel 2026`,
        `${query} instagram tiktok latvija 2026`,
      ]
    },
    {
      searches: [
        `${query} Latvija facebook twitter`,
        `${query} latvia reddit forum 2026`,
        `${query} "${query}" latvija -site:wikipedia.org`,
      ]
    }
  ];

  const makePrompt = (group) => `Tu esi Latvijas mediju meklēšanas sistēma. Šodienas datums: ${today}.

Meklē VISUS iespējamos rezultātus par: "${query}" no JEBKURA avota kas saistīts ar Latviju.

Izmanto web_search rīku un veic šos vaicājumus:
${group.searches.map((s, i) => `${i + 1}. ${s}`).join("\n")}

SVARĪGI:
- Meklē VISOS avotos — ziņu portāli, blogi, forumi, sociālie tīkli, video, podkāsti, valdības lapas, u.c.
- Nav ierobežojumu par avotu — ja tas ir saistīts ar Latviju un satur "${query}", iekļauj to
- Prioritizē jaunāko saturu (2026. gads)
- Iekļauj arī krievu un angļu valodas avotus par Latviju

Atgriezies TIKAI ar JSON masīvu:
[{"id":1,"type":"article","source":"delfi","sourceName":"Delfi.lv","title":"virsraksts","excerpt":"2-3 teikumi latviešu valodā","date":"${today}","dateLabel":"Šodien","url":"https://...","timestamps":null,"relevance":85,"lang":"lv"}]

Vērtību saraksti:
- type: "article","video","audio","social"
- source: "delfi","lsm","apollo","tvnet","jauns","ltv","lr","youtube","social","other"
- lang: "lv","ru","en"
- timestamps: null vai [{time:"MM:SS",text:"..."}] tikai video/audio
- dateLabel: "Šodien","Vakar","X dienas atpakaļ","X nedēļas atpakaļ"
- Ja avots nav sarakstā — izmanto "other" un norādi īsto nosaukumu sourceName laukā

Atgriezies ar 10-15 rezultātiem. Jaunākie pirmie. TIKAI JSON!`;

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
    // Visi 5 izsaukumi paralēli
    const allResults = await Promise.all(searchGroups.map(callAPI));
    const combined = allResults.flat();

    // Noņem dublikātus pēc URL un virsraksta
    const seen = new Set();
    const unique = combined.filter((r) => {
      const key = (r.url || "") + (r.title || "");
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Unikāli ID un sakārtoti — jaunākie pirmie
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
