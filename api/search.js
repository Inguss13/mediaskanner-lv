export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { query, dateFilter = "all" } = req.body || {};
  if (!query) return res.status(400).json({ error: "Query is required" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "API key nav konfigurēta serverī" });

  const now = new Date();
  const today = now.toISOString().split("T")[0];
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yyyy = now.getFullYear();

  // ── Izvelk JSON masīvu no teksta ─────────────────────────────────────────
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
    } catch { return []; }
  }

  // ── Izvelk īsto datumu no raksta HTML ────────────────────────────────────
  async function fetchRealDate(url) {
    if (!url || !url.startsWith("http")) return null;
    try {
      const r = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; MediaSkanner/1.0)" },
        signal: AbortSignal.timeout(4000),
      });
      if (!r.ok) return null;
      const html = await r.text();

      // Meklē datumu metadatos — vairāki formāti
      const patterns = [
        /<meta[^>]+property="article:published_time"[^>]+content="([^"]+)"/i,
        /<meta[^>]+name="publish_date"[^>]+content="([^"]+)"/i,
        /<meta[^>]+name="date"[^>]+content="([^"]+)"/i,
        /<time[^>]+datetime="([^"]+)"/i,
        /"datePublished"\s*:\s*"([^"]+)"/i,
        /"publishedDate"\s*:\s*"([^"]+)"/i,
        /class="[^"]*date[^"]*"[^>]*>([^<]{6,30})</i,
      ];

      for (const pattern of patterns) {
        const match = html.match(pattern);
        if (match && match[1]) {
          const d = new Date(match[1]);
          if (!isNaN(d.getTime())) {
            return d.toISOString().split("T")[0];
          }
        }
      }
      return null;
    } catch { return null; }
  }

  // ── dateLabel no datuma ───────────────────────────────────────────────────
  function makeDateLabel(dateStr) {
    if (!dateStr) return "Nezināms datums";
    const d = new Date(dateStr);
    const diffMs = now - d;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return "Šodien";
    if (diffDays === 1) return "Vakar";
    if (diffDays < 7)  return `${diffDays} dienas atpakaļ`;
    if (diffDays < 14) return "1 nedēļa atpakaļ";
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} nedēļas atpakaļ`;
    if (diffDays < 60) return "1 mēnesis atpakaļ";
    if (diffDays < 365) return `${Math.floor(diffDays / 30)} mēneši atpakaļ`;
    return `${Math.floor(diffDays / 365)} gads atpakaļ`;
  }

  // ── Meklēšanas grupas ─────────────────────────────────────────────────────
  const searchGroups = [
    { searches: [
      `${query} Latvija ${yyyy}-${mm}`,
      `${query} Latvia news ${yyyy}`,
      `${query} Latvija šodien ${yyyy}`,
    ]},
    { searches: [
      `${query} site:delfi.lv`,
      `${query} site:lsm.lv`,
      `${query} site:apollo.lv`,
    ]},
    { searches: [
      `${query} site:tvnet.lv`,
      `${query} site:jauns.lv`,
      `${query} site:nra.lv OR site:ir.lv`,
    ]},
    { searches: [
      `${query} Latvijas televīzija LTV ${yyyy}`,
      `${query} Latvijas radio ${yyyy}`,
      `${query} site:replay.lsm.lv`,
    ]},
    { searches: [
      `${query} youtube latvia ${yyyy}`,
      `${query} Latvija facebook ${yyyy}-${mm}`,
      `${query} Latvija instagram tiktok ${yyyy}`,
    ]}
  ];

  const makePrompt = (group) => `Tu esi Latvijas mediju meklēšanas sistēma. Šodienas datums: ${today}.

Meklē rezultātus par: "${query}"

Izmanto web_search un veic šos vaicājumus:
${group.searches.map((s, i) => `${i + 1}. ${s}`).join("\n")}

SVARĪGI par datumiem:
- Norādi TIKAI datumu ko FAKTISKI redzi rakstā vai meklēšanas rezultātā
- Ja datums nav zināms, raksti "unknown"
- NEKAD neizdomā datumu

Atgriezies TIKAI ar JSON masīvu:
[
  {
    "id": 1,
    "type": "article",
    "source": "delfi",
    "sourceName": "Delfi.lv",
    "title": "Raksta virsraksts",
    "excerpt": "2-3 teikumi par saturu latviešu valodā.",
    "date": "YYYY-MM-DD vai unknown",
    "dateLabel": "",
    "url": "https://www.delfi.lv/raksts",
    "timestamps": null,
    "relevance": 85,
    "lang": "lv"
  }
]

Pieļaujamās vērtības:
- type: "article", "video", "audio", "social"
- source: "delfi","lsm","apollo","tvnet","jauns","ltv","lr","youtube","social","other"
- lang: "lv","ru","en"
- timestamps: null vai [{"time":"04:32","text":"konteksts"}] tikai video/audio

Atgriezies ar 8-12 rezultātiem. TIKAI JSON!`;

  // ── API izsaukums ─────────────────────────────────────────────────────────
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
      return extractJSON(text);
    } catch { return []; }
  };

  try {
    // Paralēli visi 5 meklēšanas izsaukumi
    const allResults = await Promise.all(searchGroups.map(callAPI));
    const combined = allResults.flat();

    // Noņem dublikātus
    const seen = new Set();
    const unique = combined.filter((r) => {
      if (!r || typeof r !== "object") return false;
      const key = (r.url || "") + "|" + (r.title || "");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Pārbauda ĪSTOS datumus no avota lapām (paralēli, max 20)
    const toVerify = unique.slice(0, 20);
    const verifiedDates = await Promise.all(
      toVerify.map(async (r) => {
        // Ja datums ir "unknown" vai izskatās neprecīzs — pārbauda URL
        const needsVerify = !r.date || r.date === "unknown" || r.date.length < 8;
        const realDate = needsVerify ? await fetchRealDate(r.url) : null;
        const finalDate = realDate || (r.date !== "unknown" ? r.date : null);
        return {
          ...r,
          date: finalDate || null,
          dateLabel: makeDateLabel(finalDate),
          dateVerified: !!realDate,
        };
      })
    );

    // Datumu filtrēšana
    const cutoff = new Date(now);
    if (dateFilter === "day")   cutoff.setDate(now.getDate() - 1);
    else if (dateFilter === "week")  cutoff.setDate(now.getDate() - 7);
    else if (dateFilter === "month") cutoff.setMonth(now.getMonth() - 1);
    else if (dateFilter === "year")  cutoff.setFullYear(now.getFullYear() - 1);
    const cutoffStr = cutoff.toISOString().split("T")[0];

    const filtered = dateFilter === "all"
      ? verifiedDates
      : verifiedDates.filter((r) => !r.date || r.date >= cutoffStr);

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
