-- Se retira la moderación previa de audio (ADR-039, ver
-- docs/reference/registro-de-decisiones.md): un audio nuevo es utilizable e
-- inmediatamente publicable, sin cola humana previa. Los `pending` existentes
-- quedan utilizables (`approved`); los `rejected` existentes se CONSERVAN
-- inutilizables — son decisiones humanas ya tomadas, no se liberan.
UPDATE "audioAsset" SET status = 'approved' WHERE status = 'pending';

-- El CHECK `(status = 'pending') = ("reviewedAt" IS NULL)` deja de tener
-- sentido sin `pending`; se retira junto con la columna que referencia.
ALTER TABLE "audioAsset" DROP CONSTRAINT "audioAsset_check1";

ALTER TABLE "audioAsset" DROP CONSTRAINT "audioAsset_status_check";
ALTER TABLE "audioAsset"
  ADD CONSTRAINT "audioAsset_status_check" CHECK (status IN ('approved', 'rejected'));
ALTER TABLE "audioAsset" ALTER COLUMN status SET DEFAULT 'approved';

-- `moderationFlags`: señales de un pre-filtro automático que nunca llegó a
-- implementarse (siempre `allow`) y que ya no tiene cola humana a la que
-- alimentar. `reviewedBy`/`reviewedAt`: sin revisión humana activa no aportan
-- información que no esté ya en `rejectionReason` (el motivo, que sí importa
-- al creador, se conserva).
ALTER TABLE "audioAsset" DROP COLUMN "moderationFlags";
ALTER TABLE "audioAsset" DROP COLUMN "reviewedBy";
ALTER TABLE "audioAsset" DROP COLUMN "reviewedAt";
