-- E-18: retira el índice parcial `ixAudioAssetPending` (0011_audio_assets),
-- ya redundante con `ixAudioAssetStatusCreatedAt` (migración anterior), que
-- lo sustituye para las tres colas de moderación (`pending`/`approved`/
-- `rejected`) en vez de solo `pending`.
DROP INDEX CONCURRENTLY IF EXISTS "ixAudioAssetPending";
