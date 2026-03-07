# MediaSkanner LV — Vercel izvietošanas instrukcija

## Struktūra
```
mediaskanner/
├── api/
│   └── search.js        ← Backend (Claude API proxy)
├── public/
│   └── index.html       ← Frontend
├── vercel.json          ← Vercel konfigurācija
└── package.json
```

---

## Soli pa solim: Vercel izvietošana

### 1. Anthropic API atslēga
1. Ej uz https://console.anthropic.com
2. Atver **API Keys** sadaļu
3. Nospied **Create Key** — nokopē atslēgu (sākas ar `sk-ant-...`)

### 2. GitHub — augšupielādē projektu
1. Ej uz https://github.com → **New repository**
2. Nosaucam: `mediaskanner-lv`
3. Nospied **Create repository**
4. Augšupielādē visus failus (drag & drop vai GitHub Desktop)

### 3. Vercel — izvieto
1. Ej uz https://vercel.com → **Sign up** ar GitHub kontu
2. Nospied **Add New Project**
3. Izvēlies `mediaskanner-lv` repozitoriju
4. Nospied **Deploy** (noklusētie iestatījumi ir pareizi)

### 4. Pievienot API atslēgu Vercel
1. Pēc deploy — atver projektu Vercel
2. Ej uz **Settings → Environment Variables**
3. Pievienot:
   - **Name:** `ANTHROPIC_API_KEY`
   - **Value:** `sk-ant-...` (tava atslēga)
4. Nospied **Save**
5. Ej uz **Deployments** → nospied **Redeploy**

### 5. Gatavs!
Vercel dos tev adresi: `https://mediaskanner-lv.vercel.app`

---

## Problēmu novēršana

| Kļūda | Risinājums |
|-------|-----------|
| `API key nav konfigurēta` | Pārbaudi Environment Variables Vercel |
| `HTTP 401` | API atslēga ir nepareiza |
| `HTTP 529` | Anthropic API ir pārslogota — mēģini vēlreiz |
| Tukši rezultāti | Normāli — AI ne vienmēr atrod katrai frāzei |

---

## Izmaksas
- **Vercel hosting:** Bezmaksas (Hobby plāns)
- **Anthropic API:** ~$0.003 per meklēšanu (Claude Sonnet)
- Ja meklē 100x dienā = ~$0.30/dienā
