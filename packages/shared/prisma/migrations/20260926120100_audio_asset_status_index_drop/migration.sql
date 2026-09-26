-- `ixAudioAssetStatusCreatedAt` se creó para las tres colas de
-- `listModerationQueue` (pending/approved/rejected). Sin moderación previa de
-- audio ya no hay ninguna consulta que filtre `audioAsset` por `status`: se
-- retira. `DROP INDEX CONCURRENTLY` en su propio fichero (no se puede mezclar
-- con ALTER TABLE de la migración anterior: revienta "cannot run inside a
-- transaction block", mismo motivo que 20260925150100_audio_asset_pending_index_drop).
DROP INDEX CONCURRENTLY IF EXISTS "ixAudioAssetStatusCreatedAt";
