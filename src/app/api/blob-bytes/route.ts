import { NextResponse } from "next/server";
export const runtime = "nodejs";

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

    const blobRes = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!blobRes.ok) {
      const txt = await blobRes.text().catch(() => "");
      return NextResponse.json(
        { error: `Private blob fetch failed (${blobRes.status}): ${txt.slice(0, 200)}` },
        { status: blobRes.status || 500 }
      );
    }

    const contentType = blobRes.headers.get("content-type") || "application/octet-stream";
    const ab = await blobRes.arrayBuffer();

    return new Response(ab, {
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
