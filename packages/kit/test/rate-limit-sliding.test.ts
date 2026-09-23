// @vitest-environment node
import type Redis from "ioredis";
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { clientIpFromHeaders, tooManyRequestsResponse } from "../src/rate-limit/http";
import { MemorySlidingWindowStore } from "../src/rate-limit/sliding";
import { RedisSlidingWindowStore } from "../src/rate-limit/sliding-redis";

/**
 * Redis falso con lo justo del sorted set que usa `RedisSlidingWindowStore`
 * (MULTI con ZREMRANGEBYSCORE/ZADD/ZCARD/ZRANGE WITHSCORES/PEXPIRE, y ZREM):
 * los tests no necesitan un Redis real (CI sin servicios).
 */
class FakeRedis {
  readonly sets = new Map<string, Map<string, number>>();
  down = false;

  private set(key: string): Map<string, number> {
    let set = this.sets.get(key);
    if (!set) {
      set = new Map();
      this.sets.set(key, set);
    }
    return set;
  }

  multi() {
    const ops: Array<() => unknown> = [];
    const chain = {
      zremrangebyscore: (key: string, min: number, max: number) => {
        ops.push(() => {
          const set = this.set(key);
          for (const [member, score] of set) if (score >= min && score <= max) set.delete(member);
          return 0;
        });
        return chain;
      },
      zadd: (key: string, score: number, member: string) => {
        ops.push(() => this.set(key).set(member, score));
        return chain;
      },
      zcard: (key: string) => {
        ops.push(() => this.set(key).size);
        return chain;
      },
      zrange: (key: string, startRaw: string, stopRaw: string) => {
        const start = Number(startRaw);
        const stop = Number(stopRaw);
        ops.push(() =>
          [...this.set(key).entries()]
            .sort((a, b) => a[1] - b[1])
            .slice(start, stop + 1)
            .flatMap(([member, score]) => [member, String(score)]),
        );
        return chain;
      },
      pexpire: () => {
        ops.push(() => 1);
        return chain;
      },
      exec: async () => {
        if (this.down) throw new Error("ECONNREFUSED");
        return ops.map((op) => [null, op()]);
      },
    };
    return chain;
  }

  async zrem(key: string, member: string) {
    return this.set(key).delete(member) ? 1 : 0;
  }
}

function clock(start = 1_000_000) {
  let now = start;
  return { now: () => now, advance: (ms: number) => (now += ms) };
}

describe.each([
  ["MemorySlidingWindowStore", (now: () => number) => new MemorySlidingWindowStore(now)],
  [
    "RedisSlidingWindowStore (Redis falso)",
    (now: () => number) =>
      new RedisSlidingWindowStore(new FakeRedis() as unknown as Redis, "test", now),
  ],
])("%s", (_name, make) => {
  it("acepta hasta el límite y rechaza el siguiente con Retry-After", async () => {
    const c = clock();
    const store = make(c.now);
    const results = [];
    for (let i = 0; i < 3; i += 1) {
      results.push(await store.hit("k", 3, 60));
      c.advance(1_000);
    }
    expect(results.map((r) => r.ok)).toEqual([true, true, true]);
    expect(results.map((r) => r.remaining)).toEqual([2, 1, 0]);

    const blocked = await store.hit("k", 3, 60);
    expect(blocked.ok).toBe(false);
    // El más antiguo entró hace 3 s: caduca dentro de 57 s.
    expect(blocked.retryAfter).toBe(57);
  });

  it("la ventana DESLIZA: no hay reinicio de golpe en el borde", async () => {
    const c = clock();
    const store = make(c.now);
    await store.hit("k", 2, 10); // t = 0
    c.advance(9_000);
    await store.hit("k", 2, 10); // t = 9 s
    expect((await store.hit("k", 2, 10)).ok).toBe(false);

    // t = 10,5 s: caducó el de t=0 pero no el de t=9 → cabe exactamente uno.
    c.advance(1_500);
    expect((await store.hit("k", 2, 10)).ok).toBe(true);
    const again = await store.hit("k", 2, 10);
    expect(again.ok).toBe(false);
    expect(again.retryAfter).toBe(9); // caduca el de t=9 s en t=19 s
  });

  it("los rechazados no cuentan: insistir tras el 429 no alarga el bloqueo", async () => {
    const c = clock();
    const store = make(c.now);
    await store.hit("k", 1, 5);
    for (let i = 0; i < 20; i += 1) {
      c.advance(200);
      expect((await store.hit("k", 1, 5)).ok).toBe(false);
    }
    c.advance(1_000); // t = 5 s: caduca el único aceptado
    expect((await store.hit("k", 1, 5)).ok).toBe(true);
  });

  it("peek consulta sin registrar: solo `hit` gasta cuota", async () => {
    const c = clock();
    const store = make(c.now);
    for (let i = 0; i < 5; i += 1) expect((await store.peek("k", 2, 60)).ok).toBe(true);
    await store.hit("k", 2, 60);
    expect(await store.peek("k", 2, 60)).toMatchObject({ ok: true, remaining: 1 });
    c.advance(10_000);
    await store.hit("k", 2, 60);
    const blocked = await store.peek("k", 2, 60);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfter).toBe(50);
  });

  it("separa las claves", async () => {
    const c = clock();
    const store = make(c.now);
    await store.hit("a", 1, 60);
    expect((await store.hit("a", 1, 60)).ok).toBe(false);
    expect((await store.hit("b", 1, 60)).ok).toBe(true);
  });
});

describe("RedisSlidingWindowStore", () => {
  it("falla abierto si Redis no responde", async () => {
    const redis = new FakeRedis();
    redis.down = true;
    const store = new RedisSlidingWindowStore(redis as unknown as Redis, "test");
    await expect(store.hit("k", 0, 60)).resolves.toEqual({ ok: true, retryAfter: 0 });
  });

  it("solo guarda los aceptados en el sorted set", async () => {
    const redis = new FakeRedis();
    const c = clock();
    const store = new RedisSlidingWindowStore(redis as unknown as Redis, "p", c.now);
    for (let i = 0; i < 5; i += 1) await store.hit("k", 2, 60);
    expect(redis.sets.get("p:rls:k")?.size).toBe(2);
  });
});

describe("clientIpFromHeaders", () => {
  it("prefiere cf-connecting-ip y x-real-ip", () => {
    expect(
      clientIpFromHeaders(
        new Headers({ "cf-connecting-ip": "1.1.1.1", "x-forwarded-for": "9.9.9.9" }),
      ),
    ).toBe("1.1.1.1");
    expect(clientIpFromHeaders(new Headers({ "x-real-ip": "2.2.2.2" }))).toBe("2.2.2.2");
  });

  it("toma la entrada más a la derecha de x-forwarded-for (la del proxy, no la del cliente)", () => {
    expect(
      clientIpFromHeaders(new Headers({ "x-forwarded-for": "6.6.6.6, 10.0.0.1, 3.3.3.3" })),
    ).toBe("3.3.3.3");
  });

  it("sin cabeceras, `unknown`", () => {
    expect(clientIpFromHeaders(new Headers())).toBe("unknown");
  });
});

describe("tooManyRequestsResponse", () => {
  it("429 con Retry-After entero, no-store y error RATE_LIMITED", async () => {
    const res = tooManyRequestsResponse(12.2);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("13");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as { error: { code: string; retryAfter: number } };
    expect(body.error).toMatchObject({ code: "RATE_LIMITED", retryAfter: 13 });
  });
});
