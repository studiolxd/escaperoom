-- 0003_users_orgs — usuarios, identidades OAuth y organizaciones (specs/14 §3)
CREATE TABLE users (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email              citext NOT NULL UNIQUE,
  password_hash      text,                      -- null si solo usa OAuth
  display_name       text NOT NULL,
  avatar_url         text,
  locale             text NOT NULL DEFAULT 'es',
  stripe_account_id  text,                       -- Stripe Connect (creador)
  stripe_customer_id text,                       -- Stripe Customer (comprador)
  is_admin           boolean NOT NULL DEFAULT false,
  is_moderator       boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz
);
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- "Creador" y "Organizador" no son roles de tabla: cualquier user puede publicar o crear eventos.
CREATE TABLE oauth_identities (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider       text NOT NULL,                 -- 'google', 'github'...
  provider_uid   text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_uid)
);

CREATE TABLE organizations (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name               text NOT NULL,
  owner_user_id      uuid NOT NULL REFERENCES users(id),
  stripe_customer_id text,
  dpa_signed_at      timestamptz,               -- requisito para claves individuales con email
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_organizations_updated_at BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE organization_members (
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_role         text NOT NULL DEFAULT 'member' CHECK (org_role IN ('owner','admin','member')),
  joined_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);
