import { storage } from "@escaperoom/kit/storage";
import { isAnonymous } from "@escaperoom/shared/services";
import { prisma } from "@escaperoom/shared/db";
import { resolveActorFromRequest } from "@/server/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ roomId: string }> };

/** Imagen de portada de sala: tipos y tamaño admitidos (mismo tope que un asset publicado). */
const EXT_BY_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/webp": "webp",
  "image/jpeg": "jpg",
};
const MAX_BYTES = 5 * 1024 * 1024;

const NO_STORE = { "Cache-Control": "no-store" };

function errorResponse(code: string, message: string, status: number): Response {
  return Response.json({ error: { code, message } }, { status, headers: NO_STORE });
}

/**
 * POST /api/rooms/:roomId/cover-image — el autor sube la imagen de portada de
 * su sala (`multipart/form-data`, campo `file`). Sigue el mismo patrón de
 * storage que las subidas de audio del editor (`@escaperoom/kit/storage`),
 * sin la capa de moderación: es solo una imagen de catálogo, no contenido del
 * juego.
 */
export async function POST(request: Request, ctx: RouteContext): Promise<Response> {
  const { roomId } = await ctx.params;
  const actor = await resolveActorFromRequest(request);
  if (isAnonymous(actor)) return errorResponse("UNAUTHORIZED", "Inicia sesión", 401);

  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: { authorId: true, coverImageKey: true },
  });
  if (!room) return errorResponse("NOT_FOUND", "La sala no existe", 404);
  if (room.authorId !== actor.userId) {
    return errorResponse("FORBIDDEN", "Solo el autor puede cambiar la portada", 403);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return errorResponse("BAD_REQUEST", "El cuerpo debe ser multipart/form-data", 400);
  }
  const file = form.get("file");
  if (!(file instanceof File)) return errorResponse("BAD_REQUEST", "Falta el campo 'file'", 400);
  if (file.size > MAX_BYTES) return errorResponse("PAYLOAD_TOO_LARGE", "Imagen demasiado grande", 413);
  const ext = EXT_BY_TYPE[file.type];
  if (!ext) return errorResponse("UNSUPPORTED_MEDIA_TYPE", "Formato de imagen no admitido", 415);

  const key = `rooms/${roomId}/cover.${ext}`;
  await storage.putObject({
    key,
    body: Buffer.from(await file.arrayBuffer()),
    contentType: file.type,
  });

  if (room.coverImageKey && room.coverImageKey !== key) {
    await storage.deleteObject(room.coverImageKey).catch(() => undefined);
  }
  await prisma.room.update({ where: { id: roomId }, data: { coverImageKey: key } });

  const url = await storage.getSignedReadUrl(key);
  return Response.json({ coverImageUrl: url }, { headers: NO_STORE });
}
