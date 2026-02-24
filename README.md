
## Launch (Employee Use + Admin Setup)

### What this is

This internal web app lets employees upload a PDF, auto-detect chapters, and generate downloadable MP3s per chapter using realistic Google voices. PDFs and generated audio are stored privately in Vercel Blob.

---

## For Employees (How to Use)

1. Open the app: **[https://YOUR-VERCEL-URL.vercel.app](https://YOUR-VERCEL-URL.vercel.app)**
2. Click **Upload PDF** and select a file.
3. After upload, chapters are auto-detected and listed with page ranges.
4. Pick a voice (use the inline preview player to sample it).
5. Click:

   * **Generate all MP3s** to render every chapter, or
   * **Generate** next to a specific chapter.
6. When generation finishes, click **Download** to save the MP3.

Notes:

* **Regenerate** will rebuild audio for that chapter using the currently selected voice.
* Downloads stream from private storage via the app’s `/api/download` route.

---

## For Admins (Vercel Setup)

### 1) Import + Deploy

* In Vercel: **New Project → Import Git Repo**
* Framework should auto-detect as **Next.js**.

### 2) Environment Variables (Required)

Set these in **Vercel → Project → Settings → Environment Variables**:

* `BLOB_READ_WRITE_TOKEN`
  Used to read/write private blobs.
* `GOOGLE_TTS_KEY_B64`
  Base64-encoded Google service account JSON for Text-to-Speech.

Optional:

* `GOOGLE_TTS_LANG` (default recommended: `en-US`)

After setting env vars, redeploy.

### 3) Vercel Blob

* Confirm **Vercel Blob storage** is connected to the project.
* Private blob storage is expected (matches the app’s design).

### 4) Deployment Protection (Important)

If **Deployment Protection** is enabled, it can block API routes and cause server-to-server calls to return an “Authentication Required” page.

Recommended for internal production use:

* Disable protection for the production deployment, **or**
* Configure a bypass strategy (if your org requires protection).

### 5) Node Version (Recommended)

Pin Node to avoid runtime surprises:

**package.json**

```json
{
  "engines": { "node": "20.x" }
}
```

---

## Voice Previews

Voice preview audio is committed to the repo and served statically:

* `public/previews/iapetus.mp3`
* `public/previews/enceladus.mp3`
* `public/previews/orus.mp3`
* `public/previews/leda.mp3`
* `public/previews/callirrhoe.mp3`

The UI loads previews from:
`/previews/<voice>.mp3`

---

## Security Notes

* Do **not** commit secrets:

  * `.env.local` must be gitignored
  * Any raw service account JSON must be gitignored
* Recommend including a `.env.example` with placeholders only.

---

## Troubleshooting (Quick)

* **API returns HTML “Authentication Required”** → Deployment Protection is intercepting requests.
* **Chapters endpoint returns 405** → Verify `export async function POST()` exists in `src/app/api/chapters/route.ts` and the frontend uses `method: "POST"`.
* **PDF extraction fails on Vercel (DOMMatrix / pdfjs issues)** → Use a Node-safe PDF extraction approach (legacy build + polyfills or swap extractor library), and avoid runtime `execFile` calls to `/scripts`.

---
