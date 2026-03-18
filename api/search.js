export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { query, dateFilter } = req.body || {};
  if (!query) return res.status(400).json({ error: "Query required" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "No API key" });

  const today = new Date().toISOString().split("T")[0];
  const yyyy = new Date().getFullYear();
  const mm = String(new Date().getMonth() + 1).padStart(2, "0");

  const dateHint = dateFilter === "day"   ? `after:${yyyy}-${mm}-${String(new Date().getDate() - 1).padStart(2,"0")}`
                 : dateFilter === "week"  ? `after:${yyyy}-${mm}-${String(Math.max(1, new Date().getDate() - 7)).padStart(2,"0")}`
                 : dateFilter === "month" ? `after:${yyyy}-${String(new Date().getMonth()).padStart(2,"0")}-01`
                 : dateFilter === "year"  ? `after:${yyyy}-01-01`
                 : "";

  const rules = `
PIEŅEM tikai konkrētu rakstu/video URL (ar ID, slug vai datumu ceļā).
IZMET: sadaļu lapas (/sports/, /ekonomika/, /tags/ utt.), mājas lapas, meklēšanas lapas.
DATUMS: tikai reāls datums no avota vai URL — null ja nezināms, NEKAD neizdomā.
TIMESTAMPS: tikai ja tiešām redzami — citādi null.
Atgriezies TIKAI ar JSON masīvu. TIKAI JSON, nekāds cits teksts!`;

  const schema = `[{"id":1,"type":"article","source":"delfi","sourceName":"Delfi.lv","title":"...","excerpt":"...","date":"${today}","dateLabel":"Šodien","url":"https://...","relevance":85,"lang":"lv","timestamps":null}]`;

  // Prompt A — ziņu portāli
  const promptA = `Šodienas datums: ${today}. Meklē konkrētus rakstus par: "${query}"
Veic šos web_search meklējumus:
1. "${query}" site:delfi.lv ${dateHint}
2. "${query}" site:lsm.lv ${dateHint}
3. "${query}" site:apollo.lv OR site:tvnet.lv ${dateHint}
4. "${query}" site:jauns.lv OR site:nra.lv OR site:ir.lv ${dateHint}
${rules}
Atgriezies ar 6-8 jaunākajiem rakstiem. Piemērs: ${schema}`;

  // Prompt B — video un audio
  const promptB = `Šodienas datums: ${today}. Meklē konkrētus video/audio par: "${query}"
Veic šos web_search meklējumus:
1. "${query}" site:ltv.lv OR site:replay.lsm.lv ${dateHint}
2. "${query}" site:tv3play.lv OR site:tv3.lv ${dateHint}
3. "${query}" site:youtube.com Latvija ${dateHint}
${rules}
Atgriezies ar 6-8 jaunākajiem video/audio. Piemērs: ${schema}`;

  function callClaude(prompt) {
    return fetch("https://api.anthropic.com/v1/messages", {
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
    }).then(r => r.ok ? r.json() : null).catch(() => null);
  }

  function extractResults(data) {
    if (!data) return [];
    const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("");
    const start = text.indexOf("[");
    const end = text.lastIndexOf("]");
    if (start === -1 || end === -1) return [];
    try {
      const parsed = JSON.parse(text.slice(start, end + 1));
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  }

  const SECTION_PATTERN = /\/(sports?|ekonomika|politika|kultura?|zinas|tags?|tema|birka|kategorija|section|search|meklet|feed|rss)\/?(\?.*)?$/i;

  function isValidContentUrl(url) {
    if (!url) return false;
    try {
      const path = new URL(url).pathname.replace(/\/$/, "");
      if (!path || path.split("/").filter(Boolean).length < 2) return false;
      if (SECTION_PATTERN.test(path)) return false;
      return true;
    } catch { return true; }
  }

  function makeDateLabel(dateStr) {
    if (!dateStr) return null;
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return null;
    const days = Math.floor((new Date() - d) / 86400000);
    if (days === 0) return "Šodien";
    if (days === 1) return "Vakar";
    if (days < 7)  return `${days} dienas atpakaļ`;
    if (days < 14) return "1 nedēļa atpakaļ";
    if (days < 30) return `${Math.floor(days / 7)} nedēļas atpakaļ`;
    if (days < 60) return "1 mēnesis atpakaļ";
    if (days < 365) return `${Math.floor(days / 30)} mēneši atpakaļ`;
    return `${Math.floor(days / 365)} gads atpakaļ`;
  }

  // Run both searches in parallel
  const [dataA, dataB] = await Promise.all([callClaude(promptA), callClaude(promptB)]);
  const combined = [...extractResults(dataA), ...extractResults(dataB)];

  const seen = new Set();
  const unique = combined
    .filter(r => {
      if (!r?.title) return false;
      if (!isValidContentUrl(r.url)) return false;
      const key = (r.url || r.title).toLowerCase().trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((r, i) => ({
      ...r,
      id: i + 1,
      dateLabel: r.date ? (makeDateLabel(r.date) || r.dateLabel) : r.dateLabel,
    }))
    .sort((a, b) => {
      if (a.date && b.date && a.date !== b.date) return b.date.localeCompare(a.date);
      if (a.date && !b.date) return -1;
      if (!a.date && b.date) return 1;
      return (b.relevance || 0) - (a.relevance || 0);
    });

  return res.status(200).json({ results: unique, total: unique.length });
}
