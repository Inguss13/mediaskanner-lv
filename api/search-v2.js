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

  async function getWordForms(query) {
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
          max_tokens: 200,
          messages: [{ role: "user", content: `Dod man 5-8 dažādas latviešu vārdformas un saistītus vārdus priekš: "${query}"\nPiemērs: "sports" → sports, sportā, sporta, sportists, sportisti\nAtgriezies TIKAI ar JSON masīvu: ["vārds1","vārds2","vārds3"]\nTIKAI JSON — nekāds cits teksts!` }],
        }),
      });
      if (!response.ok) return [query];
      const data = await response.json();
      const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("");
      const start = text.indexOf("[");
      const end = text.lastIndexOf("]");
      if (start === -1 || end === -1) return [query];
      const forms = JSON.parse(text.slice(start, end + 1));
      return Array.isArray(forms) && forms.length > 0 ? forms : [query];
    } catch { return [query]; }
  }

  async function searchWithForms(wordForms) {
    const orQuery = wordForms.slice(0, 4).join(" OR ");
    const mainQuery = wordForms[0];

    const prompt = `Tu esi Latvijas mediju meklēšanas sistēma. Šodienas datums: ${today}.

Meklē JAUNĀKOS rezultātus par: "${mainQuery}" (arī šādās formās: ${wordForms.join(", ")})

Izmanto web_search rīku un veic VISUS šos vaicājumus:
1. ${mainQuery} site:delfi.lv
2. ${mainQuery} site:lsm.lv
3. ${mainQuery} site:apollo.lv
4. ${orQuery} site:tvnet.lv OR site:jauns.lv
5. ${mainQuery} Latvija ziņas ${yyyy}-${mm}
6. ${orQuery} Latvia news ${yyyy}

SVARĪGI par datumiem:
- Norādi PRECĪZU datumu ko redzi rakstā
- Ja datums nav redzams raksti null
- NEKAD neizdomā datumu

Atgriezies TIKAI ar JSON masīvu:
[{"id":1,"type":"article","source":"delfi","sourceName":"Delfi.lv","title":"virsraksts","excerpt":"apraksts latviešu valodā","date":"2026-03-10","dateLabel":"Šodien","url":"https://delfi.lv/...","timestamps":null,"relevance":80,"lang":"lv"}]

Noteikumi:
- type: article, video, audio vai social
- source: delfi, lsm, apollo, tvnet, jauns, ltv, lr, tv3, retv, youtube, social, other
- lang: lv, ru vai en
- Atgriezies ar 10-15 rezultātiem, jaunākie pirmie. TIKAI JSON!`;

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
      if (!response.ok) return [];
      const data = await response.json();
      const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
      return extractJSON(text);
    } catch { return []; }
  }

  function makeDateLabel(dateStr) {
    if (!dateStr) return null;
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return null;
    const diffDays = Math.floor((new Date() - d) / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return "Šodien";
    if (diffDays === 1) return "Vakar";
    if (diffDays < 7)  return `${diffDays} dienas atpakaļ`;
    if (diffDays < 14) return "1 nedēļa atpakaļ";
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} nedēļas atpakaļ`;
    if (diffDays < 60) return "1 mēnesis atpakaļ";
    if (diffDays < 365) return `${Math.floor(diffDays / 30)} mēneši atpakaļ`;
    return `${Math.floor(diffDays / 365)} gads atpakaļ`;
  }

  try {
    const wordForms = await getWordForms(query);
    const results = await searchWithForms(wordForms);

    const seen = new Set();
    const unique = results.filter((r) => {
      if (!r || typeof r !== "object" || !r.title) return false;
      const key = (r.url || r.title).toLowerCase().trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const withLabels = unique.map((r, i) => ({
      ...r,
      id: i + 1,
      dateLabel: r.date ? (makeDateLabel(r.date) || r.dateLabel) : r.dateLabel,
    }));

    const final = withLabels.sort((a, b) => {
      if (a.date && b.date && a.date !== b.date) return b.date.localeCompare(a.date);
      if (a.date && !b.date) return -1;
      if (!a.date && b.date) return 1;
      return (b.relevance || 0) - (a.relevance || 0);
    });

    return res.status(200).json({ results: final, total: final.length, wordForms });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
