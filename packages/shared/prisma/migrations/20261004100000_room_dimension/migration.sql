-- Modo 3D (specs/27 §3.3, encargo 7.1a): la dimensión de una sala se fija al
-- crearla ('2d' por defecto: todas las salas existentes son 2D) y nada la
-- cambia después. El CHECK no es representable en Prisma (ver el comentario
-- `///` de `room.dimension` en schema.prisma).
ALTER TABLE "room" ADD COLUMN "dimension" TEXT NOT NULL DEFAULT '2d';
ALTER TABLE "room" ADD CONSTRAINT "ckRoomDimension" CHECK ("dimension" IN ('2d', '3d'));
