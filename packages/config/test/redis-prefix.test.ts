import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readRedisPrefixFromEnv } from "../src/redis-prefix";

describe("readRedisPrefixFromEnv", () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("no toca nada si ya viene un REDIS_PREFIX exportado", () => {
    dir = mkdtempSync(join(tmpdir(), "redis-prefix-"));
    writeFileSync(join(dir, ".env"), "REDIS_PREFIX=del_env\n");

    expect(readRedisPrefixFromEnv(dir, "ya_exportado")).toEqual({});
  });

  it("devuelve {} sin ningún .env de worktree (comportamiento de CI)", () => {
    dir = mkdtempSync(join(tmpdir(), "redis-prefix-"));

    expect(readRedisPrefixFromEnv(dir, undefined)).toEqual({});
  });

  it("lee REDIS_PREFIX del .env del propio paquete", () => {
    dir = mkdtempSync(join(tmpdir(), "redis-prefix-"));
    writeFileSync(
      join(dir, ".env"),
      "DATABASE_URL=postgresql://x\nREDIS_PREFIX=escaperoom_mi_worktree\n",
    );

    expect(readRedisPrefixFromEnv(dir, undefined)).toEqual({
      REDIS_PREFIX: "escaperoom_mi_worktree",
    });
  });

  it("recurre al .env de shared si el propio no tiene REDIS_PREFIX", () => {
    const root = mkdtempSync(join(tmpdir(), "redis-prefix-"));
    dir = root;
    const pkgDir = join(root, "kit");
    const sharedDir = join(root, "shared");
    mkdirSync(pkgDir);
    mkdirSync(sharedDir);
    writeFileSync(join(pkgDir, ".env"), "OTHER=1\n");
    writeFileSync(join(sharedDir, ".env"), "REDIS_PREFIX=escaperoom_hermano\n");

    expect(readRedisPrefixFromEnv(pkgDir, undefined)).toEqual({
      REDIS_PREFIX: "escaperoom_hermano",
    });
  });

  it("recorta espacios alrededor del valor", () => {
    dir = mkdtempSync(join(tmpdir(), "redis-prefix-"));
    writeFileSync(join(dir, ".env"), "REDIS_PREFIX=  con_espacios  \n");

    expect(readRedisPrefixFromEnv(dir, undefined)).toEqual({
      REDIS_PREFIX: "con_espacios",
    });
  });
});
