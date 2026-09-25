# Migraciones Prisma: índices parciales, CHECKs y triggers creados a mano

`schema.prisma` no puede representar índices parciales (`WHERE`), triggers, ni
funciones PL/pgSQL. El repo tiene bastantes de los tres (dedupe de webhooks de
Stripe, colas de moderación filtradas por `status`, purgas RGPD que solo
indexan lo aún no purgado, `updatedAt` puesto por trigger en vez de por
Prisma…), escritos a mano en `packages/shared/prisma/migrations/*/migration.sql`
porque el generador de Prisma no sabe emitirlos.

Esto crea un drift estructural entre el esquema (lo que Prisma "ve") y la base
de datos real (lo que de verdad hay) — E-18 de la auditoría de 2026-09-24. El
peligro no es solo documentación desactualizada: **`prisma migrate dev`
calcula su diff comparando el esquema contra la BD**, así que si alguien lo
lanza sin mirar el resultado, una construcción invisible para Prisma es
indistinguible de "esto no debería estar aquí", y puede acabar proponiendo un
`DROP INDEX`/`DROP TRIGGER`/`DROP CONSTRAINT` que borra en silencio una
protección real (dedupe de pagos, RGPD, integridad de datos).

## Política

1. **Nunca `prisma migrate dev` contra una base con estas construcciones**
   sin revisar a mano el SQL que genera antes de aplicarlo. En este repo,
   eso es prácticamente siempre — casi todos los modelos con lógica de
   negocio tienen algo manual. Usa en su lugar:
   - `prisma migrate diff --from-migrations packages/shared/prisma/migrations --to-schema-datamodel packages/shared/prisma/schema.prisma --script`
     para ver qué CREE que hay que cambiar, sin aplicarlo.
   - Edita ese SQL a mano: quita cualquier `DROP`/`ALTER` sobre un objeto
     documentado con un comentario `///` (ver más abajo) que no sea el
     cambio que de verdad quieres hacer.
   - Crea la carpeta de migración y pega el SQL ya revisado
     (`packages/shared/prisma/migrations/<timestamp>_<nombre>/migration.sql`),
     como el resto de migraciones de este directorio.
2. **Documenta cada construcción manual con un comentario `///` justo encima
   del `model` afectado en `schema.prisma`**, citando el id de la auditoría
   (`E-18`, o el id original si es de otro bloque — `E-7`, `B-16`…), el
   nombre del objeto, la migración donde se creó y para qué sirve. Es el
   único rastro que le queda a Prisma Client/`prisma format`/quien lea el
   esquema; sin él, el índice/trigger es invisible salvo que alguien abra el
   `.sql`. Ejemplo real (`session`):

   ```prisma
   /// E-7: índice parcial creado a mano (no representable en Prisma)
   /// `ixSessionCreatedAtUnpurged` sobre `createdAt` WHERE ip/userAgent aún
   /// sin purgar, para la purga horaria de `session-ip-ua-purge-prisma-store.ts`.
   model session {
     ...
   }
   ```

   Si el objeto SÍ es representable pero con una salvedad importante (p. ej.
   un `trigger` que pone `updatedAt` en vez de la app, así que el campo NO
   lleva `@updatedAt`), documenta también eso — es la clase de cosa que un
   `migrate dev` "arreglaría" añadiendo el atributo y duplicando la escritura.

3. **Un índice parcial NUNCA se representa como `@@index` normal en
   `schema.prisma`**, aunque coincida en columnas: describe una construcción
   distinta (cubre menos filas, tiene una condición) y un `@@index` sin la
   condición es peor que no ponerlo, porque sugiere que Prisma sí lo conoce.
   Esto es justo lo que arrastraba `ixAudioAssetPending` como drift
   preexistente antes de esta política (ver el comentario `///` de
   `audioAsset` en `schema.prisma`): se documenta solo con el comentario, sin
   entrada en `@@index`.

4. **Cada índice/CHECK/trigger manual con impacto de negocio real (dedupe,
   RGPD, integridad) lleva un test de integración** que compruebe contra
   Postgres que sigue existiendo —
   `packages/shared/test/schema-manual-constraints-prisma.integration.test.ts`
   consulta `pg_indexes`/`pg_constraint`/`pg_trigger` directamente. Si un
   `migrate dev` mal revisado lo tira, este test lo detecta en CI (`verify`,
   E-14) en vez de en producción. Añade un caso ahí para cualquier
   construcción manual nueva.

## Inventario actual (2026-09-25)

| Objeto | Tipo | Migración | Modelo (comentario `///`) |
|---|---|---|---|
| `uxCreditAccountUser` / `uxCreditAccountOrg` | índice único parcial | `0004_credits` | `creditAccount` |
| `trgCreditAccountUpdatedAt` | trigger (`setUpdatedAt`) | `0004_credits` | `creditAccount` |
| `ixRoomCatalog` | índice parcial | `0005_rooms` | `room` |
| `trgRoomUpdatedAt` | trigger (`setUpdatedAt`) | `0005_rooms` | `room` |
| `ixAccessKeyExpirySweep` | índice parcial | `0006_events`/`0012_access_keys` | `accessKey` |
| `uxPurchaseStripePi` | índice único parcial | `0007_purchases` | `purchase` |
| `chkPurchaseTarget` / `chkPurchasePaidNeedsStripe` | CHECK | `0007_purchases` | `purchase` |
| `trgReviewUpdatedAt` | trigger (`setUpdatedAt`) | `0009_reviews` | `review` |
| `ixContentReportStatus` | índice parcial | `0010_moderation` | `contentReport` |
| `ixModerationAppealStatus` | índice parcial | `0010_moderation` | `moderationAppeal` |
| `ixContentReportRoom` | índice parcial | `0016_moderation_pipeline` | `contentReport` |
| `uxPurchaseOwnedRoom` | índice único parcial | `20260925120000_event_payment_integrity` | `purchase` |
| `ixSessionCreatedAtUnpurged` | índice parcial | `20260925132000_session_created_at_unpurged` | `session` |
| `ixTermsAcceptanceAcceptedAtUnpurged` | índice parcial | `20260925132100_terms_acceptance_accepted_at_unpurged` | `termsAcceptance` |
| `ixAccessKeyEventEmailPending` | índice parcial | `20260925132200_access_key_event_email_pending` | `accessKey` |
| `ixAudioAssetStatusCreatedAt` | índice normal (sustituye al parcial `ixAudioAssetPending`, drift resuelto) | `20260925150000_audio_asset_status_created_at_index` | `audioAsset` |

No es exhaustivo para los `CHECK` genéricos que Prisma ya avisa que existen
(comentario automático "This table contains check constraints…" en cada
modelo con alguno) — esos los reintroduce sin más `prisma db pull`; los de
la tabla de arriba son los que además condicionan lógica de negocio y
merecían su propio comentario.
