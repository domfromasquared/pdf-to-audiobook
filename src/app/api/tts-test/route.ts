import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import textToSpeech from "@google-cloud/text-to-speech";

export const runtime = "nodejs";

// Chirp 3: HD voice map (friendly key -> real Google voice name)
const CHIRP_HD_VOICES: Record<string, { languageCode: string; voiceName: string }> = {
  Iapetus: { languageCode: "en-US", voiceName: "en-US-Chirp3-HD-Iapetus" },
  Enceladus: { languageCode: "en-US", voiceName: "en-US-Chirp3-HD-Enceladus" },
  Orus: { languageCode: "en-US", voiceName: "en-US-Chirp3-HD-Orus" },
  Leda: { languageCode: "en-US", voiceName: "en-US-Chirp3-HD-Leda" },
  Callirrhoe: { languageCode: "en-US", voiceName: "en-US-Chirp3-HD-Callirrhoe" },
};

function getGoogleClient() {
  const b64 = process.env.GOOGLE_TTS_KEY_B64;
  if (!b64) throw new Error("Missing GOOGLE_TTS_KEY_B64");

  const json = Buffer.from(b64, "base64").toString("utf8");
  const credentials = JSON.parse(json);

  return new textToSpeech.TextToSpeechClient({ credentials });
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const text = body?.text;

    // Accept either a friendly key ("Iapetus") or a full voiceName ("en-US-Chirp3-HD-Iapetus")
    const voiceKey = body?.voiceKey;
    const requestedVoiceName = body?.voiceName;

    if (!text || typeof text !== "string") {
      return NextResponse.json({ error: "Missing text" }, { status: 400 });
    }

    const client = getGoogleClient();

    const chosen =
      typeof voiceKey === "string" && CHIRP_HD_VOICES[voiceKey]
        ? CHIRP_HD_VOICES[voiceKey]
        : null;

    const languageCode =
      chosen?.languageCode ||
      (typeof body?.languageCode === "string" && body.languageCode) ||
      process.env.GOOGLE_TTS_LANG ||
      "en-US";

    const voiceName =
      chosen?.voiceName ||
      (typeof requestedVoiceName === "string" && requestedVoiceName.trim()) ||
      process.env.GOOGLE_TTS_VOICE ||
      "en-US-Neural2-F";

    const [response] = await client.synthesizeSpeech({
      input: { text },
      voice: { languageCode, name: voiceName },
      audioConfig: { audioEncoding: "MP3" },
    });

    if (!response.audioContent) throw new Error("No audio returned from Google TTS");

    const buffer = Buffer.isBuffer(response.audioContent)
      ? response.audioContent
      : Buffer.from(response.audioContent as any);

    // PRIVATE upload (matches your private store)
    const blob = await put(`tts-tests/${Date.now()}.mp3`, buffer, {
      access: "private",
      contentType: "audio/mpeg",
      addRandomSuffix: false,
    });

    // Stream via your download endpoint
    const downloadUrl = `/api/download?url=${encodeURIComponent(blob.url)}&name=${encodeURIComponent(
      "tts-test.mp3"
    )}`;

    return NextResponse.json({ downloadUrl, voiceName, languageCode, voiceKey: chosen ? voiceKey : null });
  } catch (err: any) {
    console.error("TTS_TEST_ERROR:", err);
    return NextResponse.json({ error: err?.message || "TTS test failed" }, { status: 500 });
  }
}