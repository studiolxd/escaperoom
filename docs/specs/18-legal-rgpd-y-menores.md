# 18 — Legal: TOS, licencia UGC, RGPD/LOPDGDD y menores

Depende de `17-moderacion-de-contenido.md` y `12-voz-y-webcam-livekit.md` (§5).

> **Aviso:** esto no es asesoría legal. Es el documento de requisitos que un abogado
> especializado en protección de datos y menores necesita para redactar los textos reales (TOS,
> política de privacidad, DPA). Recoge decisiones de producto ya tomadas y señala explícitamente
> lo que **debe** confirmarse con asesoría antes de aceptar el primer evento educativo real o el
> primer pago. Nada de este documento se publica como texto legal vinculante tal cual.

---

## 1. Términos de Servicio (TOS) — contenido necesario

No es un borrador legal, es la lista de decisiones de producto que el TOS debe reflejar:

| Sección del TOS | Qué debe fijar | Ya decidido en |
|---|---|---|
| Edad mínima de cuenta | **18 años para crear cuenta** (jugador, creador u organizador); un menor participa sin cuenta propia, nunca contrata directamente | Diseño de producto; confirmar como requisito explícito |
| Roles y responsabilidades | Qué es un creador, un organizador, qué puede/no puede publicar | `specs/01-vision-y-alcance.md` §3 |
| Condiciones económicas | Reparto 70/30, comisión, créditos IA no reembolsables, saldo de eventos no consumido como crédito (sin reembolso) | `specs/02-modelo-de-negocio.md` §1–§3 |
| Conducta prohibida | Contenido ilegal, acoso, voces de terceros sin consentimiento, fraude en el ranking | `specs/17-moderacion-de-contenido.md` §2–§3 |
| Moderación y terminación de cuenta | Derecho a retirar contenido y suspender/cerrar cuentas, referencia a la política de strikes | `specs/17-moderacion-de-contenido.md` §5–§6 |
| Limitación de responsabilidad sobre UGC | La plataforma no garantiza calidad/exactitud del contenido de terceros; el remedio es el sistema de reportes, no una revisión previa | Consecuencia de la moderación post-publicación |
| Disponibilidad del servicio | Sin SLA formal en MVP/beta (self-hosted en un VPS) | `specs/03-arquitectura-y-stack.md` §5 |
| Ley aplicable y jurisdicción | España — a confirmar con asesoría si hay usuarios en otros países de la UE desde el lanzamiento | Pendiente de confirmar alcance geográfico inicial |

## 2. Licencia de contenido generado por el creador (UGC)

### 2.1 Qué licencia otorga el creador a la plataforma

- El creador **conserva la propiedad** de su sala (RoomPackage, textos, configuración de puzzles).
- Al publicar, otorga a la plataforma una **licencia no exclusiva, mundial, para alojar,
  reproducir, distribuir y vender** esa sala a jugadores/organizadores, mientras cuenta y sala
  permanezcan activas.
- No exclusiva deliberadamente: no impide que el creador lleve el mismo contenido a otro sitio; la
  plataforma no necesita exclusividad para que el 70/30 funcione.

### 2.2 Sala retirada o cuenta cerrada

- **Eliminación voluntaria** por el creador: los jugadores/organizadores que **ya la compraron**
  conservan acceso — la licencia sobre esa transacción sobrevive aunque la sala salga del catálogo.
- **Retirada por moderación:** mismo principio para severidad normal/alta (compras ya hechas siguen
  jugables) — **excepto** severidad crítica (contenido ilegal/seguridad de menores), donde el
  acceso se revoca también para quien ya la compró, sin excepción.

### 2.3 Audio generado por IA (ElevenLabs)

- La titularidad de contenido generado por IA no está asentada de forma uniforme y depende de los
  TOS de ElevenLabs (qué derechos cede sobre lo generado en uso comercial de terceros).
- **Punto explícito a revisar con asesoría antes de lanzar la función:** no se puede asumir
  titularidad plena solo por haberlo generado; hay que leer los TOS vigentes de ElevenLabs y
  reflejar sus condiciones en la licencia UGC de audio (puede no ser idéntica a la de contenido
  escrito/diseño).

### 2.4 Assets subidos por el creador (no generados)

- Al subir audio/imagen, el creador declara tener los derechos necesarios (cláusula estándar UGC).
- La comprobación de que eso es cierto (voces de terceros, copyright) es lo que hace el pipeline
  de moderación, **no** una verificación legal previa de la plataforma.

## 3. RGPD / LOPDGDD

### 3.1 Roles de la plataforma según el flujo de datos

| Flujo de datos | Rol de la plataforma | Rol del organizador/creador |
|---|---|---|
| Cuenta de jugador/creador/organizador | **Responsable** | — |
| Emails/datos de participantes introducidos por un organizador al generar claves individuales | **Encargado** (procesa por cuenta del organizador) | **Responsable** — necesita su propia base legal frente a sus participantes |
| Grabación RRHH | **Encargado** | **Responsable**, con consentimiento explícito ya exigido a nivel de producto |

**Consecuencia directa:** cualquier organización que use claves individuales por email (sobre todo
en contexto educativo, con datos de menores) necesita firmar un **contrato de encargo de
tratamiento (DPA)** antes de usar esa función. Se propone como requisito de onboarding: una
organización no puede activar el tipo de clave `individual` con `email` hasta tener un DPA firmado
(`organizations.dpa_signed_at`); los tipos `group`/`batch` (sin PII, código impreso o compartido)
siguen disponibles sin esa fricción — **lo recomendado por defecto para centros educativos** para
minimizar el requisito.

Endpoint: `POST /api/organizations/:id/dpa/sign`.

**Implementación (ticket 5.11).** Firma el propietario o un administrador de la organización
(`member.role` `owner`/`admin`; un miembro normal recibe 403) enviando `{ version }`, la versión del
texto que se le ha mostrado; si no es la vigente responde 409 `DPA_VERSION_MISMATCH`. Se registran
`dpaSignedAt`, `dpaVersion` y `dpaSignedBy` (migración `0014_organization_dpa`). La puerta aplica a la
**organización activa** del organizador (la sesión de Better Auth): sin ella, o sin DPA vigente,
generar claves con `emails` (cualquier tipo), activar con un `keyPlan` que los lleve, reenviar una
invitación o mandar recordatorios responde 403 `DPA_REQUIRED`; las claves sin email siguen libres.
**Cambio de versión:** subir `CURRENT_DPA_VERSION` exige **re-firma** — una firma de una versión
anterior deja de habilitar las claves con email hasta que un owner/admin acepte el texto nuevo.

### 3.2 Bases legales por categoría de dato

| Dato | Base legal | Nota |
|---|---|---|
| Cuenta (email, nombre) | Ejecución de contrato | Estándar |
| Datos de pago (vía Stripe) | Ejecución de contrato + obligación legal (facturación) | Stripe procesa la tarjeta; la plataforma solo recibe referencias |
| Analítica de producto | Interés legítimo, con mecanismo de oposición | Revisar si algún evento cruza a "perfilado" (requeriría consentimiento) |
| Claves con email de participante | El organizador es responsable; la plataforma trata por encargo | DPA obligatorio si hay email individual |
| Chat de partida | Interés legítimo (funcionalidad esencial) + moderación automática | Retención mínima (§3.3) |
| Grabación RRHH | Consentimiento explícito, unánime | Ya exigido a nivel técnico |

### 3.3 Retención de datos — plazos propuestos (a confirmar con asesoría)

| Dato | Plazo propuesto | Razón |
|---|---|---|
| Cuenta tras cierre voluntario | Anonimización inmediata de campos identificativos; se conserva registro transaccional (compras) sin datos personales visibles | Obligación fiscal de conservar facturación (4–6 años típico en España, **confirmar**) |
| `accessKey` con email de participante | 12 meses tras el evento (3 meses si `audience: educational`), luego anonimización (email → hash) — job implementado (`@escaperoom/worker`, `access-key-email-purge.ts`) | El organizador puede necesitar reconstruir asistencia meses después |
| `eventRecording` | 90 días | Ya fijado en `specs/12-voz-y-webcam-livekit.md` §5 |
| `analyticsEvent` | 24 meses en detalle; agregados anonimizados sin límite | Alinea con el particionado mensual; **falta el job de purga** |
| `contentReport` | Sin borrado automático | Histórico de moderación para detectar reincidencia de strikes |

### 3.4 Derechos de las personas interesadas

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/me/data-export` | Export completo de datos (portabilidad) en JSON descargable |
| DELETE | `/api/me` | Cierre de cuenta y anonimización según §3.3 (no borrado físico instantáneo donde hay obligación fiscal) |
| POST | `/api/organizations/:id/dpa/sign` | Aceptación del DPA antes de habilitar claves individuales con email |

Para participantes de evento **sin cuenta** (el caso del menor con clave), el ejercicio de derechos
pasa por el organizador (responsable del tratamiento de esos datos), no directamente por la
plataforma — otra razón por la que el DPA es obligatorio.

### 3.5 Encargados de tratamiento (subprocesadores) y transferencias internacionales

Cada proveedor que procesa datos de usuarios por cuenta de la plataforma necesita su propio DPA
firmado y debe listarse en la política de privacidad:

| Proveedor | Qué procesa | Nota de transferencia internacional |
|---|---|---|
| Stripe | Pagos, KYC de creadores (Connect) | Marco RGPD propio; confirmar cláusulas contractuales tipo vigentes |
| ElevenLabs | Texto → audio | Confirmar ubicación de procesamiento y garantías si es fuera del EEE |
| Resend/Postmark | Emails transaccionales | Confirmar ubicación de servidores |
| Cloudflare R2 | Almacenamiento de assets y grabaciones | — |
| LiveKit Cloud (solo si se activa como plan B) | Audio/vídeo en tránsito | Requiere su propio DPA; self-hosted evita este subprocesador mientras se mantenga |

## 4. Protección de menores — síntesis y lo que falta

Decisiones de producto ya tomadas (cámara/voz apagadas por defecto, sin mensajería 1:1, sin cuenta
propia del menor — todas en `specs/17-moderacion-de-contenido.md` §8). Lo específicamente **legal**
que falta encima:

1. **Edad de consentimiento propio en España (LOPDGDD art. 7): 14 años.** Como ningún menor da
   consentimiento propio (nunca crea cuenta ni acepta términos por sí mismo), la cuestión queda
   **evitada por diseño** más que resuelta por cumplimiento activo — pero hay que confirmarlo con
   asesoría como garantía real.
2. **El colegio/empresa es responsable del tratamiento** de los datos de sus menores/empleados
   frente a la plataforma (encargado). La plataforma no debe recabar directamente consentimiento
   de un padre/madre; esa relación es del centro con las familias. El producto solo controla
   minimizar qué datos de menores le llegan (recomendación de claves sin PII) y exigir el DPA.
3. **Grabación:** ya bloqueada por diseño para `audience: educational`, sin excepciones. Grabar
   una sesión educativa sería un producto y un análisis legal distintos.
4. **Retención de datos de menores:** decidido (borrador de DPA §6 y privacidad §4): 3 meses tras
   el evento para `audience: educational` frente a los 12 meses generales (minimización reforzada,
   art. 5.1.c/e y considerando 38 RGPD). **Falta el job de purga/hash** que aplique cualquiera de
   los dos plazos: hoy no existe en código.

## 5. Checklist antes de aceptar el primer evento educativo real o el primer pago

> **Actualizado en el ticket 6.2** (borrador técnico, no asesoría legal — ver el aviso al principio
> de este documento). Cada punto indica si quedó como **borrador técnico completado** (el texto o el
> código existen, pendientes de que un abogado los revise/apruebe) o **sigue pendiente de asesoría
> real** sin ningún artefacto todavía.

- [x] Redactar TOS y política de privacidad reales con asesoría, a partir de §1–§3. **Borrador
      técnico completado**: `packages/web/src/content/legal/terms.ts` y `.../privacy.ts`, servidos en
      `/[locale]/legal/terms` y `/[locale]/legal/privacy` con el aviso "Borrador pendiente de revisión
      legal" visible. **Sigue pendiente de asesoría real**: que un abogado los revise y los declare
      vigentes; los puntos jurisdiccionales concretos quedan marcados `[PENDIENTE ASESORÍA LEGAL: …]`
      dentro de esos mismos ficheros (derecho de desistimiento, ley aplicable/jurisdicción,
      limitación de responsabilidad, identificación del responsable del tratamiento).
- [ ] Confirmar plazos exactos de retención fiscal de `purchase` (§3.3) con asesoría fiscal. **Sigue
      pendiente de asesoría real**: ningún cambio de código en este ticket; el borrador de privacidad
      deja el plazo como `[PENDIENTE ASESORÍA LEGAL: …]` en vez de fijar un número.
- [x] Redactar plantilla de DPA para organizaciones que usen claves individuales con email (§3.1).
      **Borrador técnico completado**: `packages/web/src/content/legal/dpa-template.ts`, servido en
      `/[locale]/legal/dpa`. El MECANISMO de firma (quién firma, versión aceptada, puerta
      `DPA_REQUIRED`) ya existía del ticket 5.11 y no cambia; esta página solo añade el texto que se
      le muestra al organizador. Transferencias internacionales de subprocesadores sigue
      `[PENDIENTE ASESORÍA LEGAL: …]`.
- [ ] Revisar TOS vigentes de ElevenLabs sobre titularidad de audio generado antes de activar la
      función en producción (§2.3). **Sigue pendiente de asesoría real**: no se puede resolver sin
      leer los TOS vigentes de un tercero en el momento de activar la función; el borrador de TOS lo
      deja marcado explícitamente.
- [x] Confirmar que el diseño "sin cuenta para el menor, responsable = el centro" es suficiente
      por sí solo o necesita algo adicional (§4.1–§4.2). **Resuelto con normativa pública** en el
      borrador de privacidad §3: el art. 7 LOPDGDD solo rige tratamientos basados en el
      consentimiento del propio menor, y aquí la base legal es la del centro/organización
      (responsable), con la plataforma como encargado — el esquema que la AEPD describe para
      plataformas educativas contratadas por centros. Robusto aunque la edad suba a 16 (proyecto de
      LO de protección de menores en entornos digitales). Sigue dentro de la revisión global del
      abogado, pero ya no como punto abierto.
- [x] Implementar los endpoints de derechos RGPD de §3.4 antes de abrir registro público. **Hecho**
      (no es borrador, es código en producción): `GET /api/me/data-export` y `DELETE /api/me`
      (`packages/shared/src/services/user-data-rights.ts`, `.../user-data-rights-prisma-store.ts`,
      `packages/web/src/server/rest/user-data-rights.ts`). El alcance exacto de qué exporta y qué
      anonimiza frente a qué conserva es una decisión de producto documentada en el comentario de
      cabecera de `user-data-rights.ts` (no cerrada de forma explícita por esta spec): el export cubre
      solo datos que identifican al propio usuario (no PII de terceros que haya introducido, p. ej.
      emails de participantes de sus eventos); el borrado anonimiza el perfil y revoca
      sesiones/credenciales, pero no borra compras, reseñas, salas publicadas ni el historial de
      moderación, que sobreviven por obligación fiscal, por la licencia UGC ya concedida (§2.2) o
      porque §3.3 ya fija que el historial de moderación no tiene borrado automático.
- [ ] Firmar DPA propio con cada subprocesador de §3.5 antes de procesar datos reales. **Sigue
      pendiente de asesoría real**: es una gestión contractual con cada proveedor, fuera del alcance
      de este ticket (que solo redacta la plantilla que la plataforma ofrece a sus propios clientes
      B2B/Edu, no los contratos que la plataforma firma como cliente de sus proveedores).

## 6. Dependencias

- `specs/17-moderacion-de-contenido.md`, `specs/12-voz-y-webcam-livekit.md`,
  `specs/15-audio-y-creditos-ia.md`, `specs/13-api-rest.md`.
