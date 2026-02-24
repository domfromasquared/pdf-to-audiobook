# PDF to Chapter Audiobook

Internal web app to upload a PDF, auto-detect chapter ranges, generate per-chapter MP3s with Google TTS, and download each chapter audio file.

## Stack

- Next.js App Router (Node runtime API routes)
- Vercel Blob (private storage)
- Google Cloud Text-to-Speech

## Employee Usage

1. Open the deployed app URL.
2. Upload a PDF.
3. Wait for automatic chapter detection.
4. Choose a voice.
5. Generate all chapters or one-by-one.
6. Download MP3 files.

## Voices

- Iapetus
- Enceladus
- Orus
- Leda
- Callirrhoe

Voice previews are served from `public/previews/*.mp3`.

## Local Development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Required Environment Variables

Create `.env.local` for local dev, and set the same values in Vercel project settings.

- `GOOGLE_TTS_KEY_B64` (required): base64-encoded Google service account JSON for TTS.
- `BLOB_READ_WRITE_TOKEN` (recommended): token for private Blob read/write fallback mode.
- `GOOGLE_TTS_LANG` (optional): default language code, e.g. `en-US`.

See `.env.example` for placeholders.

## Vercel Launch Checklist

1. Connect this GitHub repo to Vercel.
2. Set environment variables in Vercel Project Settings.
3. Ensure Blob store is connected and private.
4. Deploy `main`.
5. Verify these routes respond: `/api/upload`, `/api/chapters`, `/api/render-chapter`, `/api/download`.

## Notes

- `/api/chapters` and `/api/render-chapter` read private blobs directly through the Blob SDK (no internal HTTP hop required).
- ZIP endpoint is intentionally removed from active routing for launch stability.
