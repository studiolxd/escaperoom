import { readFile } from "node:fs/promises";
import { parseRoomPackage, type RoomPackage } from "../schemas";
import type { RoomPackageRepository } from "./catalog";

/**
 * Repositorio en memoria: valida el `RoomPackage` una vez y lo sirve siempre.
 * Es la implementación que usan los tests (y cualquier superficie) para correr
 * sin base de datos ni sistema de ficheros.
 */
export function createInMemoryRoomPackageRepository(input: unknown): RoomPackageRepository {
  const roomPackage: RoomPackage = parseRoomPackage(input);
  return { load: async () => roomPackage };
}

/**
 * Repositorio que lee y valida el `RoomPackage` de un fichero JSON la primera
 * vez y lo cachea. Demuestra la capa de servicios sin depender de la base de
 * datos (ticket 0.10): el fixture del Rey Aldric se valida con los esquemas de
 * 0.6.
 */
export function createJsonFileRoomPackageRepository(filePath: string): RoomPackageRepository {
  let cached: RoomPackage | undefined;
  return {
    async load(): Promise<RoomPackage> {
      if (!cached) {
        const text = await readFile(filePath, "utf8");
        const raw: unknown = JSON.parse(text);
        cached = parseRoomPackage(raw);
      }
      return cached;
    },
  };
}
