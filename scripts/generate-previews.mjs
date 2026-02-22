import fs from "fs";
import path from "path";
import textToSpeech from "@google-cloud/text-to-speech";

const VOICES = {
  Iapetus: "en-US-Chirp3-HD-Iapetus",
  Enceladus: "en-US-Chirp3-HD-Enceladus",
  Orus: "en-US-Chirp3-HD-Orus",
  Leda: "en-US-Chirp3-HD-Leda",
  Callirrhoe: "en-US-Chirp3-HD-Callirrhoe",
};

const PREVIEW_TEXT =
  "In a city that never blinks, justice keeps watch from the shadows.";

function loadCredentials() {
  const b64 = process.env.GOOGLE_TTS_KEY_B64;
  if (!b64) throw new Error("Missing GOOGLE_TTS_KEY_B64 in env");
  const json = Buffer.from(b64, "base64").toString("utf8");
  return JSON.parse(json);
}

async function main() {
  const credentials = loadCredentials();
  const client = new textToSpeech.TextToSpeechClient({ credentials });

  const outDir = path.join(process.cwd(), "public", "previews");
  fs.mkdirSync(outDir, { recursive: true });

  for (const [key, voiceName] of Object.entries(VOICES)) {
    const filename = `${key.toLowerCase()}.mp3`;
    const outPath = path.join(outDir, filename);

    console.log(`Generating ${filename} (${voiceName})...`);

    const [resp] = await client.synthesizeSpeech({
      input: { text: PREVIEW_TEXT },
      voice: { languageCode: "en-US", name: voiceName },
      audioConfig: { audioEncoding: "MP3" },
    });

    if (!resp.audioContent) throw new Error(`No audioContent for ${key}`);

    const buf = Buffer.isBuffer(resp.audioContent)
      ? resp.audioContent
      : Buffer.from(resp.audioContent);

    fs.writeFileSync(outPath, buf);
  }

  console.log("Done! Files written to public/previews/");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});