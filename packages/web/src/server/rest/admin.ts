import {
  AdminError,
  pricingTierStatus,
  type Actor,
  type AdminErrorCode,
  type PlatformSetting,
  type PlatformSettingsService,
  type PricingTierRow,
  type PricingTierService,
} from "@escaperoom/shared/services";
import { handleDomainErrors, NO_STORE, readJson } from "./_http";

/** Dependencias inyectables de los handlers de admin (testeables sin Postgres). */
export type AdminHandlerDeps = {
  settings: PlatformSettingsService;
  pricing: PricingTierService;
  resolveActor: (request: Request) => Promise<Actor>;
  now?: () => Date;
};

/** Contextos de ruta dinámica de Next (App Router): `params` es asíncrono. */
export type SettingRouteContext = { params: Promise<{ key: string }> };
export type PricingTierRouteContext = { params: Promise<{ id: string }> };

const STATUS_BY_CODE: Record<AdminErrorCode, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  VALIDATION_ERROR: 422,
};

/** Traduce errores de dominio a la forma de error REST (specs/13 §1). */
const handle = handleDomainErrors(AdminError, STATUS_BY_CODE);

function settingJson(s: PlatformSetting) {
  return {
    key: s.key,
    value: s.value,
    isDefault: s.isDefault,
    updatedBy: s.updatedBy,
    updatedAt: s.updatedAt?.toISOString() ?? null,
  };
}

function tierJson(t: PricingTierRow, at: Date) {
  return {
    id: t.id,
    minPlayers: t.minPlayers,
    maxPlayers: t.maxPlayers,
    priceCentsPerPlayer: t.priceCentsPerPlayer,
    currency: t.currency,
    activeFrom: t.activeFrom.toISOString(),
    activeUntil: t.activeUntil?.toISOString() ?? null,
    status: pricingTierStatus(t, at),
    createdBy: t.createdBy,
    createdAt: t.createdAt.toISOString(),
  };
}

/**
 * Handlers REST de admin (specs/13 §10): ajustes de plataforma y tramos de
 * precio. Adaptadores finos sobre los servicios de `shared`; toda la
 * autorización (`isAdmin`) y validación vive en el servicio.
 */
export function createAdminHandlers(deps: AdminHandlerDeps) {
  const now = deps.now ?? (() => new Date());

  return {
    /** `GET /api/admin/settings/:key`. */
    async getSetting(request: Request, ctx: SettingRouteContext): Promise<Response> {
      return handle(async () => {
        const { key } = await ctx.params;
        const actor = await deps.resolveActor(request);
        const setting = await deps.settings.getSetting(actor, key);
        return Response.json(settingJson(setting), { headers: NO_STORE });
      });
    },

    /** `PATCH /api/admin/settings/:key` — cuerpo `{ value }`. */
    async patchSetting(request: Request, ctx: SettingRouteContext): Promise<Response> {
      return handle(async () => {
        const { key } = await ctx.params;
        const actor = await deps.resolveActor(request);
        // La autorización va antes que el cuerpo: un anónimo recibe 401, no 400.
        await deps.settings.authorize(actor);
        const setting = await deps.settings.updateSetting(actor, key, await readJson(request));
        return Response.json(settingJson(setting), { headers: NO_STORE });
      });
    },

    /** `GET /api/admin/pricing-tiers?status=scheduled|active|closed` — histórico completo. */
    async listPricingTiers(request: Request): Promise<Response> {
      return handle(async () => {
        const actor = await deps.resolveActor(request);
        const status = new URL(request.url).searchParams.get("status");
        const tiers = await deps.pricing.listTiers(actor, status === null ? {} : { status });
        const at = now();
        return Response.json(
          { items: tiers.map((t) => tierJson(t, at)), nextCursor: null },
          { headers: NO_STORE },
        );
      });
    },

    /** `POST /api/admin/pricing-tiers` — tramo nuevo. */
    async createPricingTier(request: Request): Promise<Response> {
      return handle(async () => {
        const actor = await deps.resolveActor(request);
        await deps.pricing.authorize(actor);
        const tier = await deps.pricing.createTier(actor, await readJson(request));
        return Response.json(tierJson(tier, now()), { status: 201, headers: NO_STORE });
      });
    },

    /**
     * `PATCH /api/admin/pricing-tiers/:id` — cierra el tramo y crea su sucesor
     * (o lo retira con `{ activeUntil }`). Nunca reescribe la fila vigente.
     */
    async patchPricingTier(request: Request, ctx: PricingTierRouteContext): Promise<Response> {
      return handle(async () => {
        const { id } = await ctx.params;
        const actor = await deps.resolveActor(request);
        await deps.pricing.authorize(actor);
        const result = await deps.pricing.updateTier(actor, id, await readJson(request));
        const at = now();
        return Response.json(
          {
            closed: tierJson(result.closed, at),
            created: result.created ? tierJson(result.created, at) : null,
          },
          { headers: NO_STORE },
        );
      });
    },
  };
}
