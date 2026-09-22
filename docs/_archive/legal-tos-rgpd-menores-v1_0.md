# Legal: TOS, licencia de contenido UGC, RGPD/LOPDGDD y protección de menores

Acompaña a `especificaciones-escape-room-creator-v1.0.md` (§14), `plan-moderacion-contenido-v1.0.md` (§7) y `arquitectura-livekit-v1.0.md` (§5).

> **Aviso:** esto no es asesoría legal. Es el documento de requisitos que un abogado especializado en protección de datos y menores necesita para redactar los textos reales (TOS, política de privacidad, DPA) — recoge las decisiones de producto ya tomadas en los documentos anteriores y señala explícitamente los puntos que **deben** confirmarse con asesoría antes de aceptar el primer evento educativo real o el primer pago. No se debe publicar nada de este documento como texto legal vinculante tal cual está redactado aquí.

---

## 1. Términos de Servicio (TOS) — contenido necesario

No es un borrador de texto legal, es la lista de decisiones de producto que el TOS tiene que reflejar (cada una ya tomada en documentos anteriores, aquí solo se consolidan):

| Sección del TOS | Qué debe fijar | Ya decidido en |
|---|---|---|
| Edad mínima de cuenta | **18 años para crear cuenta** (jugador, creador u organizador) — un menor participa en una sesión sin cuenta propia, nunca contrata directamente | Diseño de producto ya vigente (§3.3 especificaciones); confirmar como requisito explícito de TOS |
| Roles y responsabilidades | Qué es un creador, un organizador, qué puede/no puede publicar | `especificaciones-escape-room-creator-v1.0.md` §2 |
| Condiciones económicas | Reparto 70/30, comisión, créditos IA no reembolsables, saldo de eventos no consumido queda como crédito (sin reembolso) | `especificaciones-escape-room-creator-v1.0.md` §3.1–3.2 |
| Conducta prohibida | Contenido ilegal, acoso, voces de terceros sin consentimiento, intentos de fraude en el ranking | `plan-moderacion-contenido-v1.0.md` §2–3 |
| Moderación y terminación de cuenta | Derecho de la plataforma a retirar contenido y suspender/cerrar cuentas, referencia a la política de strikes | `plan-moderacion-contenido-v1.0.md` §5–6 |
| Limitación de responsabilidad sobre UGC | La plataforma no garantiza la calidad/exactitud del contenido creado por terceros; el mecanismo de remedio es el sistema de reportes, no una revisión previa | Consecuencia directa de la decisión de §1 de moderación (post-publicación, no pre-aprobado) |
| Disponibilidad del servicio | Sin SLA formal en MVP/beta (self-hosted en un VPS, sin garantía de uptime contractual) | `especificaciones-escape-room-creator-v1.0.md` §13 |
| Ley aplicable y jurisdicción | España (empresa española) — a confirmar con asesoría si hay usuarios en otros países de la UE desde el lanzamiento | Pendiente de confirmar alcance geográfico inicial |

---

## 2. Licencia de contenido generado por el creador (UGC)

### 2.1 Qué licencia otorga el creador a la plataforma

El creador **conserva la propiedad** de su sala (RoomPackage, textos, configuración de puzzles). Al publicar, otorga a la plataforma una **licencia no exclusiva, mundial, para alojar, reproducir, distribuir y vender** esa sala a jugadores/organizadores, mientras la cuenta y la sala permanezcan activas. No exclusiva deliberadamente: no impide que, en el futuro, el creador decida llevar el mismo contenido a otro sitio — la plataforma no necesita exclusividad para que el modelo de reparto 70/30 funcione.

### 2.2 Qué pasa cuando una sala se retira o una cuenta se cierra

Decisión de producto que el TOS debe reflejar explícitamente (práctica estándar de e-commerce de contenido digital, pero hay que dejarla escrita, no asumida):

- Si el creador **elimina voluntariamente** una sala o cierra su cuenta: los jugadores/organizadores que **ya la compraron** conservan acceso — la licencia otorgada a la plataforma sobrevive a esa transacción concreta aunque la sala deje de estar en el catálogo público.
- Si la plataforma **retira una sala por moderación** (`plan-moderacion-contenido-v1.0.md` §5): mismo principio para severidad normal/alta (compras ya hechas se mantienen jugables) — **excepto** severidad crítica (contenido ilegal/seguridad de menores), donde el acceso se revoca también para quien ya la compró, sin excepción.

### 2.3 Audio generado por IA (ElevenLabs)

La titularidad de contenido generado por IA es un área legal todavía no asentada de forma uniforme, y además depende de los términos de servicio de ElevenLabs como proveedor subyacente (qué derechos cede ElevenLabs sobre lo generado con su API en uso comercial de terceros). **Punto explícito a revisar con asesoría antes de lanzar la función de generación de audio**: no se puede asumir que la plataforma o el creador tienen titularidad plena solo por haberlo generado — hay que leer los TOS vigentes de ElevenLabs en el momento de implementar y reflejar sus condiciones en la licencia UGC de audio, que puede no ser idéntica a la de contenido escrito/diseño de sala.

### 2.4 Assets subidos por el creador (no generados)

Al subir su propio audio/imagen, el creador declara tener los derechos necesarios (misma cláusula estándar que cualquier plataforma UGC) — la comprobación de que eso es cierto (voces de terceros, copyright) es precisamente lo que hace el pipeline de `plan-moderacion-contenido-v1.0.md` §3, no una verificación legal previa por parte de la plataforma.

---

## 3. RGPD / LOPDGDD

### 3.1 Roles de la plataforma según el flujo de datos

No hay un único rol: cambia según qué dato y de quién.

| Flujo de datos | Rol de la plataforma | Rol del organizador/creador |
|---|---|---|
| Cuenta de jugador/creador/organizador (datos que la persona da directamente a la plataforma) | **Responsable del tratamiento** | — |
| Emails/datos de participantes que un organizador introduce al generar claves individuales para su evento | **Encargado del tratamiento** (procesa por cuenta del organizador) | **Responsable del tratamiento** de esos datos — necesita su propia base legal frente a sus participantes (relación laboral, matrícula educativa...) |
| Grabación RRHH (`arquitectura-livekit-v1.0.md` §5) | **Encargado del tratamiento** | **Responsable**, con consentimiento explícito ya exigido a nivel de producto |

**Consecuencia directa:** cualquier organización que use claves individuales por email (especialmente en contexto educativo, con datos de menores) necesita firmar un **contrato de encargo de tratamiento (DPA)** con la plataforma antes de poder usar esa función — no es opcional ni es solo "aceptar los TOS". Se propone como requisito de onboarding: una organización no puede activar el tipo de clave `individual` con `email` hasta tener un DPA firmado; los tipos `group`/`batch` (sin PII, código impreso o compartido) siguen disponibles sin esa fricción, y es lo que se recomienda por defecto para centros educativos precisamente para minimizar este requisito.

### 3.2 Bases legales por categoría de dato

| Dato | Base legal | Nota |
|---|---|---|
| Cuenta (email, nombre) de jugador/creador/organizador | Ejecución de contrato | Estándar |
| Datos de pago (vía Stripe) | Ejecución de contrato + obligación legal (facturación) | Stripe procesa el dato de tarjeta; la plataforma solo recibe referencias |
| Analítica de producto (`analytics_events`) | Interés legítimo, con mecanismo de oposición | A revisar si algún evento cruza a "perfilado" que requeriría consentimiento explícito |
| Claves de acceso con email de participante de evento | El organizador es responsable (§3.1) — la plataforma trata por encargo | DPA obligatorio si hay email individual |
| Chat de partida | Interés legítimo (funcionalidad esencial del producto) + moderación automática | Retención mínima, ver §3.3 |
| Grabación RRHH | Consentimiento explícito, unánime | Ya exigido a nivel técnico, `arquitectura-livekit-v1.0.md` §5.2 |

### 3.3 Retención de datos — plazos propuestos (a confirmar con asesoría)

| Dato | Plazo propuesto | Razón |
|---|---|---|
| Cuenta de usuario tras cierre voluntario | Anonimización inmediata de campos identificativos; se conserva el registro transaccional (compras) sin datos personales visibles | Obligación fiscal de conservar facturación (normativa española: 4–6 años típico, **confirmar plazo exacto con asesoría fiscal**) impide el borrado físico total |
| `access_keys` con email de participante | 12 meses tras la finalización del evento, luego anonimización (el email se sustituye por hash, el resto del registro de progreso se conserva para estadística agregada del organizador) | El organizador puede necesitar reconstruir asistencia meses después; no hay razón para conservar el email indefinidamente |
| `event_recordings` | 90 días (ya fijado en `arquitectura-livekit-v1.0.md` §5.3) | — |
| `analytics_events` | 24 meses en detalle (particiones mensuales), agregados anonimizados sin límite después | Alinea con el particionado mensual ya definido en `esquema-sql-migraciones-v1.0.md` §8 — solo falta el job de purga, no la estructura |
| `content_reports` | Sin plazo de borrado automático (histórico de moderación, base para detectar reincidencia de strikes) | Necesario para la política de strikes de moderación, que mira reincidencia en ventanas de 90 días pero se apoya en tener el histórico disponible |

### 3.4 Derechos de las personas interesadas (acceso, rectificación, supresión, portabilidad)

Addenda necesaria a `api-rest-backend-v1.0.md` §2:

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/me/data-export` | Genera un export completo de los datos del usuario (cuenta, compras, reseñas, salas propias) en JSON descargable — derecho de portabilidad |
| DELETE | `/api/me` | Solicita cierre de cuenta y anonimización según los plazos de §3.3 — no es un borrado físico instantáneo donde hay obligación fiscal de conservar el registro transaccional |
| POST | `/api/organizations/:id/dpa/sign` | Punto de aceptación del DPA (§3.1) antes de habilitar claves individuales con email |

Para participantes de evento **sin cuenta** (el caso de un menor con clave de acceso), el ejercicio de derechos pasa por el organizador (responsable del tratamiento de esos datos, §3.1), no directamente por la plataforma — otra razón por la que el DPA de §3.1 no es opcional.

### 3.5 Encargados de tratamiento (subprocesadores) y transferencias internacionales

Todo proveedor que procesa datos de usuarios por cuenta de la plataforma necesita su propio DPA firmado, y debe listarse en la política de privacidad:

| Proveedor | Qué procesa | Nota de transferencia internacional |
|---|---|---|
| Stripe | Pagos, KYC de creadores (Connect) | Stripe tiene marco de cumplimiento RGPD propio; confirmar cláusulas contractuales tipo vigentes |
| ElevenLabs | Texto → audio (generación IA) | Confirmar ubicación de procesamiento y garantías si es fuera del EEE |
| Resend/Postmark | Envío de emails transaccionales | Confirmar ubicación de servidores |
| Cloudflare R2 | Almacenamiento de assets y grabaciones | — |
| LiveKit Cloud (solo si se activa como plan B, `arquitectura-livekit-v1.0.md` §2.2) | Audio/vídeo en tránsito | Si se activa, requiere su propio DPA — self-hosted evita este subprocesador por completo mientras se mantenga |

---

## 4. Protección de menores — síntesis y lo que falta

Este documento no repite las decisiones de producto ya tomadas (cámara/voz apagadas por defecto, sin mensajería 1:1, sin cuenta propia del menor — todas en `plan-moderacion-contenido-v1.0.md` §7), sino que fija lo específicamente **legal** que falta encima de ellas:

1. **Edad de consentimiento propio en España (LOPDGDD art. 7): 14 años.** Como ningún menor da consentimiento propio en este producto (nunca crea cuenta, nunca acepta términos por sí mismo), esta cuestión queda evitada por diseño más que resuelta por cumplimiento activo — pero hay que confirmarlo con asesoría como una garantía real, no solo una suposición de que "como no tienen cuenta, no aplica".
2. **El colegio/empresa es responsable del tratamiento de los datos de sus menores/empleados** frente a la plataforma (encargado, §3.1) — la plataforma no puede ni debe intentar recabar directamente el consentimiento de un padre/madre; esa relación es del centro educativo con las familias, fuera del alcance del producto. Lo único que el producto controla es minimizar qué datos de menores le llegan (recomendación de tipos de clave sin PII, §3.1) y exigir el DPA antes de permitir lo que sí implica PII.
3. **Grabación**: ya bloqueada por diseño para `audience: educational` (`arquitectura-livekit-v1.0.md` §5.1) — sin excepciones previstas; si en el futuro se planteara grabar una sesión educativa (p. ej. para el propio centro), sería un producto y un análisis legal distintos, no una extensión de la función de RRHH.
4. **Retención de datos de menores concretamente**: el plazo de 12 meses propuesto en §3.3 para `access_keys` con email aplica igual aquí, pero conviene que la asesoría confirme si un plazo más corto es más adecuado tratándose de menores (principio de minimización reforzado).

---

## 5. Checklist antes de aceptar el primer evento educativo real o el primer pago

- [ ] Redactar TOS y política de privacidad reales con asesoría, a partir de §1–§3 de este documento.
- [ ] Confirmar plazos exactos de retención fiscal de `purchases` (§3.3) con asesoría fiscal.
- [ ] Redactar plantilla de DPA (encargo de tratamiento) para organizaciones que usen claves individuales con email (§3.1).
- [ ] Revisar TOS vigentes de ElevenLabs sobre titularidad de audio generado antes de activar esa función en producción (§2.3).
- [ ] Confirmar con asesoría que el diseño "sin cuenta para el menor, responsable = el centro" es suficiente por sí solo o si se necesita algo adicional (§4.1–§4.2).
- [ ] Implementar los tres endpoints de derechos RGPD de §3.4 antes de abrir registro público (no solo beta cerrada con usuarios de confianza).
- [ ] Firmar DPA propio con cada subprocesador de §3.5 antes de procesar datos reales de usuarios (no solo de prueba).
