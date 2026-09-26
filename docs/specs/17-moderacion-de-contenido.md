# 17 — Moderación de contenido

Depende de `14-modelo-de-datos-sql.md` (§10) y `13-api-rest.md` (§10). Resuelve la pregunta
abierta de las especificaciones originales (*"¿moderación pre-aprobada o post-publicación con
reportes?"*) y define el pipeline completo, incluido el mecanismo de **apelación**.

Con menores de por medio en eventos educativos, este documento es **bloqueante antes de la beta**
(ver `plan/fase-6-endurecimiento-y-lanzamiento.md`).

---

## 1. Decisión: post-publicación con reportes + pre-check automático que no bloquea (salvo casos claros)

La revisión pre-aprobada 100 % humana no escala con creadores gratuitos y autopublicación
instantánea (mataría la promesa "de registro a sala publicada en <30 minutos"). La decisión:

- **Publicar es instantáneo** (sin cola humana); pasa primero por un **pre-check automático** (§3)
  que puede bloquear casos claros (palabras/patrones prohibidos, hash de contenido ilegal) pero no
  retiene el resto esperando a un humano.
- **Post-publicación**, el contenido se modera por **reportes** (jugadores, organizadores, otros
  creadores) más un **muestreo aleatorio continuo** de baja intensidad sobre salas nuevas —
  necesario porque el público objetivo incluye aulas, donde el primer "reporte" real sería un
  profesor delante de sus alumnos.
- **Audio y vídeo tampoco se revisan antes de publicarse** (decisión de 2026-09-26, ADR-039, que
  retira la excepción original de este documento): el creador es responsable de todo el contenido
  de su sala y el organizador de un evento debe revisar el contenido (textos, imágenes, audios y
  vídeos) antes de usarla con su grupo, en especial si hay menores (Términos de Servicio §3 y §6).
  El control sobre audio y vídeo es el mismo que sobre el resto: posterior, por reportes.

## 2. Qué se modera (superficies)

| Superficie | Momento | Nivel |
|---|---|---|
| Metadata de sala (título, descripción) | Pre-check al publicar + reportes | Automático + humano |
| Diálogos y textos del RoomPackage (`dialogs`, pistas) | Pre-check al publicar + reportes | Automático + humano |
| Audio/vídeo subidos o generados por el creador | Post-publicación + reportes | Humano (por reporte, sin pre-check previo) |
| Reseñas de jugadores | Post-publicación + reportes | Automático + humano |
| Chat de texto en partida | En vivo | Automático (filtro), sin cola humana (§7) |
| Nombre de usuario / perfil de creador | Al registrarse/editar | Automático |

## 3. Pipeline automático

No bloqueante salvo en los casos marcados 🛑:

| Comprobación | Aplica a | Acción |
|---|---|---|
| Filtro de lenguaje (listas + clasificador de toxicidad) | Título, descripción, diálogos, reseñas, chat | 🟡 flag si supera umbral medio; 🛑 bloquea publicar/enviar si supera umbral alto (insultos graves, contenido sexual explícito) |
| Hash matching contra bases de contenido ilegal conocido (CSAM y similares) | Toda imagen/audio subido | 🛑 bloquea la subida y dispara el flujo de §5.1 (severidad máxima), no un ticket normal |
| Detección de PII (emails, teléfonos, direcciones) | Chat de partida, diálogos | 🟡 flag — en chat con menores es alerta prioritaria (§7) |
| Clasificador de imagen (violencia gráfica, contenido sexual) — v2 | Imágenes subidas | 🛑 bloquea la subida si supera umbral |

El pre-check corre **de forma síncrona y rápida (<2 s)** en `POST /api/rooms/:roomId/publish` y en
la subida de assets — es un paso más del pipeline de validación, junto al validador de
solvabilidad, no un sistema aparte.

> **2026-09-26 (ADR-039):** se retira la detección de voces de terceros y la coincidencia de
> copyright como pre-check con cola humana previa — nunca llegaron a implementarse (la única
> implementación real era un pre-filtro manual que siempre dejaba pasar) y, sin cola de audio,
> no tenían a quién alimentar. Si en el futuro se implementan, alimentan reportes automáticos
> (`source: "precheck"`, §2) sobre la sala ya publicada, no un bloqueo previo.

## 4. Cola de revisión humana

Sobre `contentReport` (`severity`, `category`, `source`) y `GET/PATCH /api/admin/reports`.

### 4.1 SLA por severidad

| Severidad | Ejemplos | Primera revisión | Acción mientras se revisa |
|---|---|---|---|
| **Crítica** | Contenido ilegal, seguridad de menores, hash conocido | **< 1 h, 24/7** (alerta directa) | Sala publicada; entra el primero de la cola (revisado 2026-09-25, ver §5.1 y ADR-013) |
| **Alta** | Acoso dirigido, contenido sexual no explícito inapropiado, sospecha de voz de tercero | **< 24 h** laborables | Sala publicada salvo reincidencia del mismo creador |
| **Normal** | Lenguaje ofensivo leve, calidad/spam, copyright dudoso | **< 5 días** laborables | Sin acción hasta revisión |
| **Baja** | Reseñas duplicadas, quejas de gusto/dificultad | **< 10 días** laborables, o se cierra en lote | Sin acción |

### 4.2 Priorización

Dentro de una severidad: (1) salas con evento activo o próximo en 48 h, (2) volumen de reportes
distintos sobre la misma sala, (3) antigüedad del reporte.

### 4.3 Quién revisa

- Fase inicial (beta y primeros meses): el propio equipo (`is_moderator = true`), sin outsourcing.
- Cuando el volumen lo justifique: moderación externa **solo** para `spam`/`quality`/`copyright`;
  nunca para `minor_safety` ni `illegal_content`.

## 5. Escalado por severidad

### 5.1 Crítica (contenido ilegal / seguridad de menores)

> **Revisado 2026-09-25 (ADR-013, A-3 de la auditoría de seguridad):** un reporte de usuario con
> `category: minor_safety | illegal_content` **ya no despublica la sala ni congela la cuenta al
> insertarse**. La severidad la fija la categoría que elige el propio reportante, sin verificación
> previa: sin este cambio, una cuenta gratuita podía retirar salas ajenas y congelar cuentas al
> instante, de forma automatizable, con la única cuota general de reportes. La detección
> automática por hash de contenido ilegal conocido (§3, aún no implementada) es harina de otro
> costal: ahí sí hay verificación técnica previa a la acción, no la palabra de un reportante.

1. El reporte entra en la cola de moderación con **máxima prioridad** (severidad crítica, §4.2) y
   una cuota de creación más estricta que la general (política `report-write-critical`).
2. La sala sigue publicada y la cuenta del creador sigue activa mientras se revisa.
3. Revisión humana en <1 h confirma o descarta.
4. Si se confirma: despublicación, **ban permanente inmediato** (sin política de strikes previa —
   esta categoría no tiene "primera falta") y, si procede, congelación de la cuenta para preservar
   evidencia.
5. Conservación de evidencia y, cuando aplique, reporte a las autoridades (canal a definir con
   asesoría legal).

### 5.2 Alta

1. Revisión humana en <24 h.
2. Si se confirma: retirada de la sala/asset + strike (§6) + notificación con motivo concreto.
3. Reincidencia (2ª alta en 90 días) → suspensión temporal de la cuenta (no puede publicar, sí
   puede jugar) mientras se revisa el histórico.

### 5.3 Normal / baja

1. Revisión humana en el SLA correspondiente.
2. Si se confirma: se pide corrección al creador (editar y republicar) antes de retirar — el
   contenido sigue publicado mientras se resuelve, salvo que el volumen de reportes escale su
   severidad efectiva.

## 6. Política de strikes

Aplica a creadores (contenido de sus salas/assets). **No** aplica a jugadores por comportamiento
en el chat de partida (eso se cubre en §7, chat efímero ligado a una sesión).

| Strike | Consecuencia |
|---|---|
| 1º (alta o normal confirmada) | Aviso formal + motivo + posibilidad de corregir sin perder la sala (§5.3) |
| 2º en 90 días | Suspensión temporal de publicación nueva (14 días); las salas ya publicadas sin infracción activa se mantienen |
| 3º en 90 días, o cualquier crítica | Ban permanente como creador (puede conservar cuenta de jugador si el motivo no era seguridad de menores) |

Los strikes caducan a los 90 días **sin reincidencia** — no se acumulan indefinidamente por una
falta leve aislada.

## 7. Mecanismo de apelación

Un creador puede apelar tanto un bloqueo de pre-check al publicar como una retirada/strike ya
aplicado. Tabla `moderationAppeal` (`specs/14-modelo-de-datos-sql.md` §10).

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| POST | `/api/rooms/:roomId/appeal` | autor de la sala | Apela un bloqueo de pre-check o una retirada sobre esa sala |
| POST | `/api/me/appeal` | usuario | Apela una suspensión de cuenta (sin sala concreta) |
| GET | `/api/admin/appeals` | `is_admin \| is_moderator` | Cola de apelaciones pendientes |
| PATCH | `/api/admin/appeals/:id` | `is_admin \| is_moderator` | Resuelve: `upheld` (se mantiene) u `overturned` (se revierte — reincorpora sala o levanta strike) |

- Entra en la misma cola y SLA que §4, con severidad `normal` — **salvo** que la apelación sea
  sobre un caso `crítico`, donde no aplica: esos no tienen apelación (no tienen "primera falta").
- Métrica de salud: **% de pre-check bloqueados que resultan falso positivo** (si es alto, se
  ajustan umbrales).

## 8. Consideraciones específicas: menores en eventos educativos

El producto ya incorpora medidas de protección **antes** de llegar a moderación:

- **Los jugadores invitados a un evento no necesitan cuenta** propia: un menor participa con un
  código que reparte su profesor, sin crear perfil ni email propio expuesto (salvo invitación por
  email decidida por el organizador).
- **Cámara desactivada por defecto** en eventos educativos (`canPublishVideo: false`) y **voz
  apagada por defecto**, activables solo por decisión explícita.
- **No existe mensajería privada 1:1:** el chat es siempre visible para todo el grupo y muere con
  la sesión — no hay superficie de contacto adulto-menor fuera del grupo supervisado.

Medidas de moderación añadidas:

- **Filtro de chat en vivo** con umbral más estricto en sesiones educativas (`events.audience =
  'educational'`).
- **El chat no se modera en cola humana** (sería revisar conversaciones privadas de menores, un
  problema de privacidad en sí mismo): se modera **en el momento**, automáticamente, y solo se
  conserva un log mínimo (evento de analítica, sin contenido textual completo, salvo incidente
  grave, donde el mensaje concreto se retiene como evidencia para §5.1).
- **El organizador (adulto responsable) es siempre visible** en el grupo como observador o
  jugador — el diseño no permite una sesión de menores sin un adulto con acceso.
- Cualquier reporte `category: minor_safety` se trata siempre como severidad **crítica**, aunque
  el texto parezca leve: el criterio es que involucra a un menor.

> Este apartado es un mínimo de producto/moderación; no sustituye el análisis legal
> (`specs/18-legal-rgpd-y-menores.md`).

## 9. Métricas del proceso

- Tiempo medio de primera revisión por severidad (vs. SLA de §4.1).
- % de pre-check bloqueado que era falso positivo.
- % de salas publicadas que reciben al menos un reporte en sus primeros 30 días.
- Nº de strikes / bans por mes (tendencia, no objetivo).
- Cobertura del muestreo aleatorio sobre salas nuevas — objetivo inicial: 100 % en beta cerrada,
  decreciente a un % fijo al crecer.

## 10. Dependencias

- `specs/15-audio-y-creditos-ia.md` — audio y vídeo, sin moderación previa (ADR-039).
- `specs/18-legal-rgpd-y-menores.md` — menores, PII, retención.
- `specs/13-api-rest.md` §10 — endpoints admin.
