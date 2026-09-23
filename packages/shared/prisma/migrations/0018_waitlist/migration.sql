-- 0017_waitlist — waitlist de la landing pública (ticket 6.7, specs/20 §1, §5)
CREATE TABLE "waitlistSignup" (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       citext NOT NULL,
  locale      text NOT NULL,
  source      text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE (email)
);
