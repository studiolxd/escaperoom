-- 0017_audio_ai_generation — generación de audio por IA (ticket 4.9, specs/15 §1-4).
-- Reusa la MISMA tabla `audioAsset` (0011) y el MISMO pipeline de moderación de las
-- subidas propias: una generación nace 'pending' y pasa por la cola humana antes de
-- quedar disponible. `source` distingue el origen; los créditos ya se cobraron al
-- confirmar (specs/15 §3), por eso se guarda el coste para trazabilidad/auditoría.
ALTER TABLE "audioAsset"
  ADD COLUMN "source" text NOT NULL DEFAULT 'upload'
    CHECK ("source" IN ('upload', 'ai_generated')),
  ADD COLUMN "generationText" text,
  ADD COLUMN "generationVoiceId" text,
  ADD COLUMN "generationCreditsCost" int CHECK ("generationCreditsCost" IS NULL OR "generationCreditsCost" > 0);

ALTER TABLE "audioAsset"
  ADD CONSTRAINT "chkAudioAssetGenerationFields" CHECK (
    ("source" = 'ai_generated') = ("generationText" IS NOT NULL AND "generationVoiceId" IS NOT NULL AND "generationCreditsCost" IS NOT NULL)
  );
