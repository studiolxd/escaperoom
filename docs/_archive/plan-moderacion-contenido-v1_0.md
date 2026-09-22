# Plan de moderación de contenido

Acompaña a `especificaciones-escape-room-creator-v1.0.md` (§14), `esquema-sql-migraciones-v1.0.md` (§10, `content_reports`) y `api-rest-backend-v1.0.md` (§10).

Este documento resuelve la pregunta abierta desde la primera versión de las especificaciones (*"¿moderación con contenido pre-aprobado o post-publicado con reportes?"*) y define el pipeline completo: qué se modera, qué se comprueba automático, qué pasa por cola humana, cómo se escala y la política de strikes. Con menores de por medio en los eventos educativos, este documento no es opcional antes de abrir la beta.

---

## 1. Decisión: post-publicación con reportes, más un pre-check automático ligero que no bloquea

Revisión pre-aprobada 100 % humana no escala con un modelo de creadores gratuito y autopublicación instantánea (mata la promesa de "de registro a sala publicada en <30 minutos", `planificacion-ampliada-puntos-1-12.md` §4). La decisión:

- **Publicar es instantáneo** (sin cola de espera humana) — pasa primero por un **pre-check automático** (§3) que puede bloquear casos claros (palabras/patrones prohibidos, hash conocido de contenido ilegal) pero no retiene el resto a la espera de un humano.
- **Post-publicación**, el contenido vive expuesto y se modera por **reportes** (jugadores, organizadores, otros creadores) más un **muestreo aleatorio continuo** de baja intensidad sobre salas nuevas (no solo reactivo a reportes — necesario porque el público objetivo incluye aulas, donde el primer "reporte" real sería un profesor delante de sus alumnos, que es tarde).
- **Las subidas de assets custom (audio v2, imágenes v2)** son la excepción: pasan por cola humana **antes** de quedar disponibles para usar en una sala publicada (ya adelantado en `planificacion-ampliada-puntos-1-12.md` §3.4) — es contenido nuevo sin ningún historial, y el coste de revisar un archivo suelto es mucho menor que retener la sala entera.

---

## 2. Qué se modera (superficies)

| Superficie | Momento | Nivel |
|---|---|---|
| Metadata de sala (título, descripción) | Pre-check al publicar + reportes | Automático + humano |
| Diálogos y textos dentro del RoomPackage (`dialogs`, pistas) | Pre-check al publicar + reportes | Automático + humano |
| Audio/imágenes subidos por el creador | Antes de estar disponibles en el editor | Humano (con pre-filtro automático) |
| Audio generado por IA (ElevenLabs) | Al generar, antes de guardar | Automático (mismo pipeline que subida propia — `planificacion-ampliada-puntos-1-12.md` §3.4) |
| Reseñas de jugadores | Post-publicación + reportes | Automático + humano |
| Chat de texto en partida | En vivo | Automático (filtro), sin cola humana (ver §7 — es efímero y no queda expuesto públicamente) |
| Nombre de usuario / perfil de creador | Al registrarse/editar | Automático |

---

## 3. Pipeline automático

No bloqueante salvo en los casos marcados 🛑:

| Comprobación | Aplica a | Acción |
|---|---|---|
| Filtro de lenguaje (listas + clasificador de toxicidad) | Título, descripción, diálogos, reseñas, chat | 🟡 flag para revisión si supera umbral medio; 🛑 bloquea publicar/enviar si supera umbral alto (insultos graves, contenido sexual explícito) |
| Hash matching contra bases de contenido ilegal conocido (CSAM y similares) | Toda imagen/audio subido | 🛑 bloquea la subida, no genera ticket de revisión "normal" — dispara directamente el flujo de §5.1 (severidad máxima) |
| Detección de PII (emails, teléfonos, direcciones) | Chat de partida, diálogos | 🟡 flag — en chat de partida con menores es señal de alerta prioritaria (ver §7) |
| Clasificador de imagen (violencia gráfica, contenido sexual) — v2, cuando existan assets de imagen custom | Imágenes subidas | 🛑 bloquea la subida si supera umbral |
| Detección de voces de terceros sin consentimiento (audio) | Subida y generación IA | 🟡 flag para revisión humana — un clasificador automático no puede confirmar consentimiento, solo señalar sospecha de voz reconocible |
| Coincidencia de assets con material con copyright conocido | Imagen/audio subido | 🟡 flag (no bloquea: hay falsos positivos frecuentes; lo resuelve el humano) |

El pre-check corre **de forma síncrona y rápida** (<2 s) en `POST /api/rooms/:roomId/publish` y en la subida de assets — es un paso más del pipeline de validación, junto al validador de solvabilidad (`plan-pruebas-qa-v1.0.md` §2), no un sistema aparte.

---

## 4. Cola de revisión humana

Se apoya en la tabla `content_reports` ya definida (`esquema-sql-migraciones-v1.0.md` §10) y los endpoints `GET/PATCH /api/admin/reports` (`api-rest-backend-v1.0.md` §10). Ampliación de campos necesaria sobre lo ya especificado:

```sql
-- adenda a 0010_moderation.sql
ALTER TABLE content_reports ADD COLUMN severity     text NOT NULL DEFAULT 'normal'
  CHECK (severity IN ('critical', 'high', 'normal', 'low'));
ALTER TABLE content_reports ADD COLUMN category     text NOT NULL DEFAULT 'other';
  -- 'illegal_content' | 'minor_safety' | 'harassment' | 'copyright' | 'spam' | 'quality' | 'other'
ALTER TABLE content_reports ADD COLUMN source       text NOT NULL DEFAULT 'user_report';
  -- 'user_report' | 'auto_flag' | 'random_sample'
```

### 4.1 SLA por severidad

| Severidad | Ejemplos | Tiempo objetivo de primera revisión | Acción mientras se revisa |
|---|---|---|---|
| **Crítica** | Contenido ilegal, seguridad de menores, hash conocido | **< 1 hora**, 24/7 (alerta directa, no solo cola) | Despublicación automática inmediata, no espera revisión (§5.1) |
| **Alta** | Acoso dirigido, contenido sexual no explícito pero inapropiado, sospecha fundada de voz de tercero sin consentimiento | **< 24 h** laborables | Sala se mantiene publicada salvo reincidencia del mismo creador |
| **Normal** | Lenguaje ofensivo leve, calidad/spam, copyright dudoso | **< 5 días laborables** | Sin acción hasta revisión |
| **Baja** | Reseñas duplicadas, quejas de gusto/dificultad sin infracción | **< 10 días laborables**, o se cierra en lote | Sin acción |

### 4.2 Priorización de la cola

Dentro de una misma severidad, se ordena por: (1) salas con un evento activo o próximo en las siguientes 48 h (`events.status = active` con sesiones programadas — un profesor va a usarla pronto), (2) volumen de reportes distintos sobre la misma sala, (3) antigüedad del reporte.

### 4.3 Quién revisa

- Fase inicial (beta y primeros meses): el propio equipo (`is_moderator = true`), sin outsourcing — volumen bajo, y el criterio para el caso "aulas" necesita contexto de producto que un moderador externo genérico no tiene.
- Cuando el volumen lo justifique (métrica: horas de cola humana de `planificacion-ampliada-puntos-1-12.md`, sección de costes), se evalúa moderación externa solo para las categorías `spam`/`quality`/`copyright` — nunca para `minor_safety` ni `illegal_content`, que se quedan siempre en el equipo.

---

## 5. Escalado por severidad

### 5.1 Crítica (contenido ilegal / seguridad de menores)

1. Despublicación **automática e inmediata** (no espera a un humano) en cuanto el pre-check (§3) o un reporte marcado `category: minor_safety | illegal_content` lo detecta.
2. Congelación de la cuenta del creador (no borrado, para preservar evidencia).
3. Revisión humana en <1 hora confirma o revierte (falso positivo posible en el filtro automático).
4. Si se confirma: **ban permanente inmediato**, sin política de strikes previa — esta categoría no tiene "primera falta".
5. Conservación de evidencia y, cuando aplique, reporte a las autoridades competentes (canal a definir con asesoría legal — cruce directo con el punto 10 pendiente, legal/RGPD/protección de menores).

### 5.2 Alta

1. Revisión humana en <24h.
2. Si se confirma: retirada de la sala/asset concreto (no ban automático de cuenta) + strike (§6) + notificación al creador con el motivo concreto.
3. Reincidencia (2ª alta en 90 días) → suspensión temporal de la cuenta (no puede publicar, sí puede seguir jugando) mientras se revisa el histórico completo.

### 5.3 Normal / baja

1. Revisión humana en el SLA correspondiente.
2. Si se confirma: se pide corrección al creador (editar y republicar) antes de retirar — a diferencia de crítica/alta, aquí el contenido sigue publicado mientras se resuelve, salvo que el volumen de reportes sobre la misma sala escale su severidad efectiva.

---

## 6. Política de strikes

Aplica a creadores (contenido de sus salas/assets). No aplica a jugadores por su comportamiento en el chat de partida — eso se cubre en §7 con sus propias reglas, dado que el chat es efímero y ligado a una sesión concreta, no a contenido publicado permanente.

| Strike | Consecuencia |
|---|---|
| 1º (severidad alta o normal confirmada) | Aviso formal + explicación del motivo + posibilidad de corregir sin perder la sala si aplica (§5.3) |
| 2º en 90 días | Suspensión temporal de publicación nueva (14 días); las salas ya publicadas y sin infracción activa se mantienen |
| 3º en 90 días, o cualquier severidad crítica | Ban permanente de la cuenta como creador (puede conservar su cuenta de jugador si el motivo no era de seguridad de menores) |

Los strikes caducan a los 90 días **sin reincidencia** — no se acumulan indefinidamente por una falta leve aislada.

---

## 7. Consideraciones específicas: menores en eventos educativos

El producto ya incorpora varias decisiones de diseño que reducen el riesgo antes de llegar a moderación (se listan aquí para que quede explícito que son, entre otras cosas, medidas de protección, no solo de producto):

- **Los jugadores invitados a un evento no necesitan cuenta propia** (`especificaciones-escape-room-creator-v1.0.md` §3.3): un menor participa con un código que reparte su profesor/organizador, sin crear perfil, sin email propio expuesto a la plataforma salvo que el organizador decida usar invitación por email.
- **Cámara desactivada por defecto en eventos educativos** (`canPublishVideo: false`, `protocolo-mensajes-colyseus.md` §8) y voz también apagada por defecto (`planificacion-ampliada-puntos-1-12.md`), activable solo por decisión explícita.
- **No existe mensajería privada 1:1** en ningún punto del producto: el chat de partida es siempre visible para todo el grupo de la sesión (`protocolo-mensajes-colyseus.md` §6) y muere con la sesión — no hay superficie de contacto adulto-menor fuera del grupo supervisado.

Medidas de moderación que se añaden sobre esa base:

- **Filtro de chat en vivo** (§3) con umbral más estricto en sesiones marcadas como evento educativo (`events` con `grouping_mode` gestionado por organizador — proxy razonable de "es un aula" hasta que exista un campo explícito `audience: 'general' | 'educational'` en `events`, a añadir).
- **El chat no se modera en cola humana** (sería revisar conversaciones privadas de menores, lo cual es en sí mismo un problema de privacidad) — se modera **en el momento**, automáticamente, y solo se conserva un log mínimo (evento de analítica, sin contenido textual completo, salvo que el filtro lo marque como incidente grave, en cuyo caso el mensaje concreto sí se retiene como evidencia para el flujo de §5.1).
- **El organizador (adulto responsable) es siempre visible en el grupo** como observador o jugador — el diseño no permite una sesión de menores sin un adulto con acceso al mismo `SpectatorRoom`/sesión.
- Cualquier reporte con `category: minor_safety` se trata siempre como severidad **crítica**, nunca inferior, aunque el contenido en sí (por texto) pudiera parecer leve — el criterio no es la gravedad literal del texto sino que involucra a un menor.

Este apartado es un mínimo de producto/moderación, no sustituye el análisis legal (RGPD/LOPDGDD, consentimiento, retención de datos de menores) que corresponde al punto 10 pendiente — se referencia aquí para que ese documento parta de estas decisiones ya tomadas y no las contradiga.

---

## 8. Métricas del propio proceso

- Tiempo medio de primera revisión por severidad (vs. SLA de §4.1).
- % de contenido pre-check bloqueado que era falso positivo (recurso de apelación del creador → si el % es alto, se ajustan umbrales).
- % de salas publicadas que reciben al menos un reporte en sus primeros 30 días.
- Nº de strikes emitidos / nº de bans permanentes por mes (tendencia, no objetivo — un aumento puede significar más usuarios, no necesariamente peor comportamiento).
- Cobertura del muestreo aleatorio (§1) sobre salas nuevas — objetivo inicial: 100 % de salas nuevas en beta cerrada (volumen bajo lo permite), decreciente a un % fijo cuando el volumen crezca.
