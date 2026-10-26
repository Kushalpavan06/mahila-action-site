import { NextRequest, NextResponse } from "next/server";
import { queryDb } from "@/lib/db";
import { getAdminFromRequest } from "@/lib/auth";

export const dynamic = "force-dynamic";

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/svg+xml",
  "image/avif",
  "image/bmp",
]);

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

/**
 * Parses a data URL (e.g. data:image/png;base64,iVBOR...) into a Buffer and MIME type.
 */
function parseDataUrl(dataUrl: string): { buffer: Buffer; mimeType: string } | null {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  const mimeType = match[1].toLowerCase();
  const buffer = Buffer.from(match[2], "base64");
  return { buffer, mimeType };
}

export async function POST(req: NextRequest) {
  const admin = await getAdminFromRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "Not authenticated as admin" }, { status: 401 });
  }

  try {
    let filename = "image";
    let mimeType = "image/jpeg";
    let buffer: Buffer | null = null;

    const contentType = req.headers.get("content-type") || "";

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const file = formData.get("file") as File | null;
      if (!file) {
        return NextResponse.json({ error: "No file provided in form data" }, { status: 400 });
      }

      filename = file.name || "image";
      mimeType = (file.type || "image/jpeg").toLowerCase();
      const arrayBuffer = await file.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
    } else {
      // Handle JSON payload (e.g. { dataUrl: "data:image/png;base64,...", filename?: "crop.png" })
      const body = await req.json();
      if (!body.dataUrl || typeof body.dataUrl !== "string") {
        return NextResponse.json({ error: "Missing dataUrl in request body" }, { status: 400 });
      }

      const parsed = parseDataUrl(body.dataUrl);
      if (!parsed) {
        return NextResponse.json({ error: "Invalid base64 data URL format" }, { status: 400 });
      }

      buffer = parsed.buffer;
      mimeType = parsed.mimeType;
      filename = body.filename || `image-${Date.now()}.${mimeType.split("/")[1] || "png"}`;
    }

    if (!buffer || buffer.length === 0) {
      return NextResponse.json({ error: "Empty image file received" }, { status: 400 });
    }

    if (buffer.length > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `Image file exceeds maximum allowed size of 10 MB (${(buffer.length / (1024 * 1024)).toFixed(1)} MB)` },
        { status: 400 }
      );
    }

    // Default mime type fallback if generic application/octet-stream was sent
    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      if (filename.endsWith(".jpg") || filename.endsWith(".jpeg")) mimeType = "image/jpeg";
      else if (filename.endsWith(".png")) mimeType = "image/png";
      else if (filename.endsWith(".webp")) mimeType = "image/webp";
      else if (filename.endsWith(".gif")) mimeType = "image/gif";
      else if (filename.endsWith(".svg")) mimeType = "image/svg+xml";
      else {
        return NextResponse.json(
          { error: `Unsupported image MIME type: ${mimeType}. Allowed formats: JPEG, PNG, WebP, GIF, SVG, AVIF.` },
          { status: 400 }
        );
      }
    }

    const byteSize = buffer.length;

    const res = await queryDb(
      `INSERT INTO media (filename, mime_type, byte_size, data)
       VALUES ($1, $2, $3, $4)
       RETURNING id, filename, mime_type, byte_size, created_at`,
      [filename, mimeType, byteSize, buffer]
    );

    const row = res.rows[0];
    const url = `/api/media/${row.id}`;

    return NextResponse.json(
      {
        ok: true,
        id: row.id,
        url,
        filename: row.filename,
        mimeType: row.mime_type,
        byteSize: row.byte_size,
        createdAt: row.created_at,
      },
      { status: 201 }
    );
  } catch (err: any) {
    console.error("POST /api/media error:", err);
    return NextResponse.json({ error: err.message || "Failed to store image in database" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const limit = Math.min(Number(url.searchParams.get("limit") || 50), 100);
    const offset = Math.max(Number(url.searchParams.get("offset") || 0), 0);

    const res = await queryDb(
      `SELECT id, filename, mime_type, byte_size, created_at
       FROM media
       ORDER BY created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    const items = res.rows.map((row: any) => ({
      id: row.id,
      url: `/api/media/${row.id}`,
      filename: row.filename,
      mimeType: row.mime_type,
      byteSize: Number(row.byte_size),
      createdAt: row.created_at,
    }));

    return NextResponse.json({ ok: true, items });
  } catch (err: any) {
    console.error("GET /api/media error:", err);
    return NextResponse.json({ error: "Failed to list media items" }, { status: 500 });
  }
}
