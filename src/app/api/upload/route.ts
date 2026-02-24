import { put } from "@vercel/blob";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    // Some browsers don't set file.type reliably, so we also allow .pdf extension.
    const isPdf =
      file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");

    if (!isPdf) {
      return NextResponse.json({ error: "Only PDF files are allowed" }, { status: 400 });
    }

    // Sanitize filename for storage path safety
    const safeName = file.name
      .replace(/[^\w.\- ]+/g, "")
      .replace(/\s+/g, " ")
      .trim();

    const blob = await put(`pdfs/${Date.now()}-${safeName}`, file, {
      access: "private", // matches your private Blob store
      contentType: "application/pdf",
      addRandomSuffix: false,
    });

    return NextResponse.json({
      pdfUrl: blob.url,
      fileName: file.name,
    });
  } catch (err: any) {
    console.error("UPLOAD_ERROR:", err);
    return NextResponse.json(
      { error: err?.message || "Upload failed" },
      { status: 500 }
    );
  }
}