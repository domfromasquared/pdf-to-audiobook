import { NextResponse } from "next/server";
import { get } from "@vercel/blob";

export const runtime = "nodejs";

function blobUrlToPathname(blobUrl: string) {
  const u = new URL(blobUrl);
  // pathname starts with "/pdfs/..." or "/tts-tests/..."
  return u.pathname.replace(/^\/+/, ""); // remove leading slash
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const url = searchParams.get("url");
    const name = searchParams.get("name") || "download.bin";

    if (!url) {
      return NextResponse.json({ error: "Missing url" }, { status: 400 });
    }

    const token = process.env.BLOB_READ_WRITE_TOKEN;
    if (!token) {
      return NextResponse.json(
        { error: "Missing BLOB_READ_WRITE_TOKEN in environment" },
        { status: 500 }
      );
    }

    const pathname = blobUrlToPathname(url);

    // ✅ Correct private-blob read: get(pathname, { access: "private" })
    const result: any = await get(pathname, { access: "private", token });

    if (result?.statusCode && result.statusCode !== 200) {
      return NextResponse.json({ error: "Blob not found" }, { status: 404 });
    }

    const contentType = result?.blob?.contentType || "application/octet-stream";
    const stream = result?.stream;

    if (!stream) {
      return NextResponse.json({ error: "Blob stream missing" }, { status: 500 });
    }

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${name}"`,
      },
    });
  } catch (err: any) {
    console.error("DOWNLOAD_ERROR:", err);
    return NextResponse.json(
      { error: err?.message || "Download failed" },
      { status: 500 }
    );
  }
}