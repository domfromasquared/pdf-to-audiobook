import { NextResponse } from "next/server";
import { get } from "@vercel/blob";

export const runtime = "nodejs";

function blobUrlToPathname(blobUrl: string) {
  const u = new URL(blobUrl);
  return u.pathname.replace(/^\/+/, "");
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const url = searchParams.get("url");

    if (!url) {
      return NextResponse.json({ error: "Missing url" }, { status: 400 });
    }

    const token = process.env.BLOB_READ_WRITE_TOKEN;
    const readOpts: any = { access: "private" };
    if (token) readOpts.token = token;

    let result: any;
    try {
      result = await get(url, readOpts);
    } catch {
      const pathname = blobUrlToPathname(url);
      result = await get(pathname, readOpts);
    }

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
      headers: { "Content-Type": contentType },
    });
  } catch (err: any) {
    console.error("BLOB_BYTES_ERROR:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to read blob bytes" },
      { status: 500 }
    );
  }
}
