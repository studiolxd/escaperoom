import { isAnonymous, type Actor } from "./actor";

/**
 * Onboarding de Stripe Connect para creadores (ticket 5.1, specs/02 §2,
 * specs/13 §2). El marketplace usa "separate charges and transfers": la
 * plataforma es el merchant of record y transfiere el reparto al creador
 * (`services/events.ts` → `PaymentGateway.createTransfer`), así que la cuenta
 * conectada del creador es de tipo `recipient` (Express, solo recibe
 * transferencias, sin `card_payments`/`merchant`) — nunca cobra directo.
 */

export type ConnectAccountStatus = "not_started" | "pending" | "complete";

/** Lo que el servicio necesita saber del usuario. */
export type CreatorConnectUserRef = {
  id: string;
  email: string;
  stripeAccountId: string | null;
};

/** Puerto de persistencia (ADR-022): solo lee/escribe `user.stripeAccountId`. */
export interface CreatorConnectStore {
  findUser(userId: string): Promise<CreatorConnectUserRef | null>;
  saveAccountId(userId: string, accountId: string): Promise<void>;
}

/**
 * Puerto de Stripe Connect. `null` sin `STRIPE_SECRET_KEY`: los endpoints
 * responden `PAYMENT_GATEWAY_UNAVAILABLE` (503/501 según adaptador).
 */
export interface ConnectGateway {
  /** Cuenta Express `recipient`: solo recibe transferencias (specs/02 §2). */
  createExpressAccount(input: { email: string }): Promise<{ accountId: string }>;
  createOnboardingLink(input: {
    accountId: string;
    refreshUrl: string;
    returnUrl: string;
  }): Promise<{ url: string }>;
  getAccountStatus(accountId: string): Promise<ConnectAccountStatus>;
  /** Enlace de un solo uso al dashboard Express de la cuenta (solo con onboarding completo). */
  createDashboardLink(accountId: string): Promise<{ url: string }>;
}

export type CreatorConnectErrorCode =
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "PAYMENT_GATEWAY_UNAVAILABLE"
  | "ONBOARDING_NOT_COMPLETE";

/** Error de dominio; los adaptadores lo traducen a HTTP/tRPC/MCP. */
export class CreatorConnectError extends Error {
  readonly code: CreatorConnectErrorCode;
  constructor(code: CreatorConnectErrorCode, message: string) {
    super(message);
    this.name = "CreatorConnectError";
    this.code = code;
  }
}

function requireUser(actor: Actor): void {
  if (isAnonymous(actor)) throw new CreatorConnectError("UNAUTHORIZED", "No hay sesión");
}

export function createCreatorConnectService(deps: {
  store: CreatorConnectStore;
  /** `null` sin `STRIPE_SECRET_KEY`. */
  connect: ConnectGateway | null;
}) {
  async function requireExistingUser(actor: Actor): Promise<CreatorConnectUserRef> {
    requireUser(actor);
    const user = await deps.store.findUser(actor.userId);
    if (!user) throw new CreatorConnectError("NOT_FOUND", "Usuario no encontrado");
    return user;
  }

  return {
    authorize(actor: Actor): void {
      requireUser(actor);
    },

    /**
     * `POST /api/me/stripe-connect` — crea la cuenta conectada si no existe
     * (se guarda `user.stripeAccountId` en el primer onboarding) y devuelve la
     * URL hospedada del flujo de onboarding de Stripe. Reentrante: con cuenta
     * ya creada, genera un enlace de onboarding nuevo sobre la misma cuenta
     * (siguen faltando requisitos) o de actualización si ya está completa.
     */
    async startOnboarding(
      actor: Actor,
      urls: { refreshUrl: string; returnUrl: string },
    ): Promise<{ url: string }> {
      const user = await requireExistingUser(actor);
      if (!deps.connect) {
        throw new CreatorConnectError(
          "PAYMENT_GATEWAY_UNAVAILABLE",
          "El onboarding de pagos todavía no está disponible",
        );
      }
      let accountId = user.stripeAccountId;
      if (!accountId) {
        const created = await deps.connect.createExpressAccount({ email: user.email });
        accountId = created.accountId;
        await deps.store.saveAccountId(user.id, accountId);
      }
      const link = await deps.connect.createOnboardingLink({ accountId, ...urls });
      return { url: link.url };
    },

    /**
     * `GET /api/me/stripe-connect/status` — `not_started` sin cuenta creada;
     * si no, el estado en vivo de Stripe (nunca se cachea en Postgres: el
     * webhook `account.updated` solo confirma que hay que refrescar).
     */
    async getStatus(actor: Actor): Promise<{ status: ConnectAccountStatus }> {
      const user = await requireExistingUser(actor);
      if (!user.stripeAccountId) return { status: "not_started" };
      if (!deps.connect) {
        throw new CreatorConnectError(
          "PAYMENT_GATEWAY_UNAVAILABLE",
          "El estado de la cuenta todavía no está disponible",
        );
      }
      return { status: await deps.connect.getAccountStatus(user.stripeAccountId) };
    },

    /**
     * `GET /api/me/stripe-connect/dashboard` — enlace de un solo uso al
     * dashboard Express de Stripe, solo si el onboarding ya está completo
     * (specs/02 §2).
     */
    async getDashboardLink(actor: Actor): Promise<{ url: string }> {
      const user = await requireExistingUser(actor);
      if (!user.stripeAccountId) {
        throw new CreatorConnectError("ONBOARDING_NOT_COMPLETE", "Todavía no ha iniciado el onboarding");
      }
      if (!deps.connect) {
        throw new CreatorConnectError(
          "PAYMENT_GATEWAY_UNAVAILABLE",
          "El dashboard de pagos todavía no está disponible",
        );
      }
      const status = await deps.connect.getAccountStatus(user.stripeAccountId);
      if (status !== "complete") {
        throw new CreatorConnectError("ONBOARDING_NOT_COMPLETE", "El onboarding todavía no está completo");
      }
      return deps.connect.createDashboardLink(user.stripeAccountId);
    },
  };
}

export type CreatorConnectService = ReturnType<typeof createCreatorConnectService>;

// ── Implementaciones en memoria (tests y superficies sin base de datos) ────

export function createInMemoryCreatorConnectStore(
  users: Array<{ id: string; email: string; stripeAccountId?: string | null }>,
): CreatorConnectStore & { rows: Map<string, CreatorConnectUserRef> } {
  const rows = new Map(users.map((u) => [u.id, { ...u, stripeAccountId: u.stripeAccountId ?? null }]));
  return {
    rows,
    async findUser(userId) {
      const row = rows.get(userId);
      return row ? { ...row } : null;
    },
    async saveAccountId(userId, accountId) {
      const row = rows.get(userId);
      if (row) row.stripeAccountId = accountId;
    },
  };
}

/** Pasarela falsa: cuentas y links ficticios, sin tocar Stripe. */
export function createFakeConnectGateway(): ConnectGateway & { accounts: Map<string, ConnectAccountStatus> } {
  const accounts = new Map<string, ConnectAccountStatus>();
  let seq = 0;
  return {
    accounts,
    async createExpressAccount() {
      const accountId = `fake_acct_${(seq += 1)}`;
      accounts.set(accountId, "pending");
      return { accountId };
    },
    async createOnboardingLink({ accountId }) {
      return { url: `https://connect.example.test/onboarding/${accountId}` };
    },
    async getAccountStatus(accountId) {
      return accounts.get(accountId) ?? "not_started";
    },
    async createDashboardLink(accountId) {
      return { url: `https://connect.example.test/dashboard/${accountId}` };
    },
  };
}
