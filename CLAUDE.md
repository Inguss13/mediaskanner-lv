# MediaSkanner LV — CLAUDE.md

## Projekta apraksts
Latvijas mediju meklēšanas rīks. Lietotājs ievada atslēgvārdu, sistēma meklē rakstus, video un audio no Latvijas ziņu portāliem (Delfi, LSM, Apollo, TVNet u.c.) un atgriež rezultātus, sakārtotus pēc jaunākā datuma.

## Failu struktūra
```
/public/index.html   — viss frontend (HTML + CSS + JS vienā failā)
/api/search.js       — aktīvais meklēšanas endpoint (POST /api/search)
/api/search-v2.js    — eksperimentāls endpoint ar vārdformu atpazīšanu
/vercel.json         — Vercel maršrutēšana
```

## Tehnoloģijas
- **Frontend:** Vanilla HTML/CSS/JS (bez framework)
- **Backend:** Vercel serverless funkcijas (ES modules)
- **AI:** Anthropic Claude API ar `web_search_20250305` rīku
- **Modelis:** `claude-sonnet-4-6`
- **Hostings:** Vercel

## Vide
- `ANTHROPIC_API_KEY` — jāiestata Vercel environment variables

## API — /api/search
**Metode:** POST
**Body:** `{ "query": "meklēšanas vārds", "dateFilter": "all|day|week|month|year" }`
**Atbilde:** `{ "results": [...], "total": 5 }`

Rezultātu lauki:
```json
{
  "id": 1,
  "type": "article|video|audio|social",
  "source": "delfi|lsm|apollo|tvnet|jauns|ltv|lr|tv3|youtube|other",
  "sourceName": "Delfi.lv",
  "title": "...",
  "excerpt": "...",
  "date": "2026-03-18",
  "dateLabel": "Šodien",
  "url": "https://...",
  "relevance": 85,
  "lang": "lv|ru|en",
  "timestamps": null
}
```

## Svarīgie noteikumi

### Meklēšanas kvalitāte
- Tiek atgriezti tikai **konkrēti raksti/video** — ne sadaļu vai kategoriju lapas
- URL filtrācija serverī: izmet `/sports/`, `/ekonomika/`, `/tags/` u.c.
- Datumi: tikai reāli datumi no avota, `null` ja nezināms

### Lokālā testēšana
Vercel projektu var palaist lokāli ar:
```bash
npm install -g vercel
vercel dev
```

### Koda stils
- ES modules (`export default`)
- Bez TypeScript
- CSS mainīgie `--var` stilā, definēti `:root`
- Fonti: Syne (virsraksti), DM Sans (teksts), DM Serif Display (liels teksts)
- Krāsu palete: `--bg #f0ede8`, `--ink #111010`, `--red #e8321a`, `--orange #f5a623`
