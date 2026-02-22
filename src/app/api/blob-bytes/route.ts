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
    if (!token) {
      return NextResponse.json({ error: "Missing BLOB_READ_WRITE_TOKEN" }, { status: 500 });
    }

    const pathname = blobUrlToPathname(url);

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