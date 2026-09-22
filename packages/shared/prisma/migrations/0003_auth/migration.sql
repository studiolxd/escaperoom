-- 0003_auth — modelo canónico de Better Auth (specs/14 §3, ADR-016).
-- Core: user, session, account, verification. Plugin de organización:
-- organization, member, invitation. Columnas camelCase; ids de auth = text.
CREATE TABLE "user" (
  id                  text PRIMARY KEY,
  name                text NOT NULL,
  email               citext NOT NULL UNIQUE,
  "emailVerified"     boolean NOT NULL DEFAULT false,
  image               text,
  locale              text NOT NULL DEFAULT 'es',
  "stripeAccountId"   text,                       -- Stripe Connect (creador)
  "stripeCustomerId"  text,                       -- Stripe Customer (comprador)
  "isAdmin"           boolean NOT NULL DEFAULT false,
  "isModerator"       boolean NOT NULL DEFAULT false,
  "createdAt"         timestamptz NOT NULL DEFAULT now(),
  "updatedAt"         timestamptz NOT NULL DEFAULT now(),
  "deletedAt"         timestamptz
);

CREATE TABLE "session" (
  id                     text PRIMARY KEY,
  "expiresAt"            timestamptz NOT NULL,
  token                  text NOT NULL UNIQUE,
  "createdAt"            timestamptz NOT NULL DEFAULT now(),
  "updatedAt"            timestamptz NOT NULL DEFAULT now(),
  "ipAddress"            text,
  "userAgent"            text,
  "userId"               text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  "activeOrganizationId" text
);
CREATE INDEX "ixSessionUserId" ON "session"("userId");

CREATE TABLE "account" (
  id                       text PRIMARY KEY,
  "accountId"              text NOT NULL,
  "providerId"             text NOT NULL,
  "userId"                 text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  "accessToken"            text,
  "refreshToken"           text,
  "idToken"                text,
  "accessTokenExpiresAt"   timestamptz,
  "refreshTokenExpiresAt"  timestamptz,
  scope                    text,
  password                 text,
  "createdAt"              timestamptz NOT NULL DEFAULT now(),
  "updatedAt"              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "ixAccountUserId" ON "account"("userId");

CREATE TABLE "verification" (
  id          text PRIMARY KEY,
  identifier  text NOT NULL,
  value       text NOT NULL,
  "expiresAt" timestamptz NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "ixVerificationIdentifier" ON "verification"(identifier);

-- "Creador" y "Organizador" no son roles de tabla: cualquier user puede publicar o crear eventos.
CREATE TABLE "organization" (
  id                  text PRIMARY KEY,
  name                text NOT NULL,
  slug                text NOT NULL UNIQUE,
  logo                text,
  metadata            text,
  "stripeCustomerId"  text,
  "dpaSignedAt"       timestamptz,               -- requisito para claves individuales con email
  "createdAt"         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "member" (
  id                text PRIMARY KEY,
  "organizationId"  text NOT NULL REFERENCES "organization"(id) ON DELETE CASCADE,
  "userId"          text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  role              text NOT NULL DEFAULT 'member',
  "createdAt"       timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("organizationId", "userId")
);
CREATE INDEX "ixMemberOrganizationId" ON "member"("organizationId");
CREATE INDEX "ixMemberUserId" ON "member"("userId");

CREATE TABLE "invitation" (
  id                text PRIMARY KEY,
  "organizationId"  text NOT NULL REFERENCES "organization"(id) ON DELETE CASCADE,
  email             citext NOT NULL,
  role              text,
  status            text NOT NULL DEFAULT 'pending',
  "expiresAt"       timestamptz NOT NULL,
  "createdAt"       timestamptz NOT NULL DEFAULT now(),
  "inviterId"       text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE
);
CREATE INDEX "ixInvitationOrganizationId" ON "invitation"("organizationId");
CREATE INDEX "ixInvitationEmail" ON "invitation"(email);
