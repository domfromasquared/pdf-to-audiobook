import { NextResponse } from "next/server";
import archiver from "archiver";
import { get } from "@vercel/blob";

export const runtime = "nodejs";

function blobUrlToPathname(blobUrl: string) {
  const u = new URL(blobUrl);
  return u.pathname.replace(/^\/+/, "");
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const files: Array<{ name: string; url: string }> = body?.files;

    if (!Array.isArray(files) || files.length === 0) {
      return NextResponse.json({ error: "Missing files" }, { status: 400 });
    }

    const token = process.env.BLOB_READ_WRITE_TOKEN;
    if (!token) {
      return NextResponse.json({ error: "Missing BLOB_READ_WRITE_TOKEN" }, { status: 500 });
    }

    const archive = archiver("zip", { zlib: { level: 9 } });

    const stream = new ReadableStream({
      start(controller) {
        archive.on("data", (chunk) => controller.enqueue(chunk));
        archive.on("end", () => controller.close());
        archive.on("error", (err) => controller.error(err));
      },
      cancel() {
        archive.abort();
      },
    });

    // Add each MP3 to the zip
    (async () => {
      for (const f of files) {
        if (!f?.url || !f?.name) continue;

        const pathname = blobUrlToPathname(f.url);
        const result: any = await get(pathname, { access: "private", token });

        if (!result?.stream) continue;

        archive.append(result.stream, { name: f.name });
      }

      await archive.finalize();
    })();

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="chapters.zip"`,
      },
    });
  } catch (err: any) {
    console.error("ZIP_ERROR:", err);
    return NextResponse.json({ error: err?.message || "Failed to create zip" }, { status: 500 });
  }
}