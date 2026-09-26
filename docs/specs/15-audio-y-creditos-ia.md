# 15 — Audio y créditos IA

Depende de `03-arquitectura-y-stack.md`, `08-formato-roompackage.md` y `17-moderacion-de-contenido.md`.
El esquema de créditos está en `specs/14-modelo-de-datos-sql.md` §4.

---

## 1. Tres fuentes de audio para el creador

| Fuente | Descripción |
|---|---|
| **Biblioteca incluida** | Música ambiental por tema, efectos (puertas, mecanismos, aciertos, fallos), voces del narrador base. Sin coste, sin problemas de licencia. |
| **Subida propia** | El creador sube sus MP3/OGG (música, efectos, voces). **Disponible al instante, sin moderación previa** (specs/17 §1): el creador es responsable del contenido y el organizador de un evento decide si es adecuado para su grupo. Límite de tamaño por sala (p. ej. 50 MB). |
| **Generación IA (ElevenLabs)** | Voces narradas, diálogos de NPC y textos generados con la API de ElevenLabs desde el editor. |

## 2. Créditos y tokens (uso de la IA)

- La app vende **créditos** que los creadores gastan en generaciones IA (ElevenLabs y futuros
  servicios: imágenes, música).
- Los créditos son **a nivel de plataforma**: un pool de tokens internos (no créditos ElevenLabs
  directos) que la plataforma canjea en su cuenta global de ElevenLabs, con margen.
- **Todo el subsistema de usuarios, organizaciones y ledger de créditos ya está desarrollado en
  SLXD** → se copia/adapta tal cual: cuentas personales y de organización ilimitadas, saldo,
  histórico de movimientos, compra de créditos, consumo por uso.
- Coste contable por generación: nº de caracteres × tarifa ElevenLabs → conversión a créditos
  internos (redondeo a la unidad, mínimo 1 crédito por generación). Margen objetivo ≥ 50 %.

### 2.1 Trazabilidad por idioma

El audio generado es **inherentemente por idioma** (ver `specs/08-formato-roompackage.md` §2.2).
Por tanto:

- El `credit_movement.reference_id` de una generación es `{dialogId o hintId}:{locale}` — un mismo
  diálogo con audio en dos idiomas genera dos movimientos distintos, cada uno trazable a su locale.
- El audio generado queda asociado a la **organización** (no solo a un usuario): cualquier miembro
  puede reutilizarlo en sus salas.

## 3. Integración en el editor

- En cualquier campo de audio (diálogo, pista, efecto): botón "Generar con IA" → texto →
  previsualización → confirmar. **Los créditos se descuentan al confirmar, no al previsualizar.**
- La llamada crea un `credit_movement` (`movement_type: 'consumption'`) mediante
  `applyCreditMovement`, con `reference_type: 'audio_generation'`.
- El archivo resultante se sube a R2 y se referencia en el `LocalizedText.audioUrl` del locale.
- La previsualización no toca el ledger; solo la escritura definitiva consume créditos.

## 4. Moderación de audio (decisión de 2026-09-26, ADR-039)

- Una subida propia o una generación por IA quedan **disponibles al instante**: sin estado
  pendiente, sin bloqueo al publicar, sin cola de revisión previa. Ya no hay excepción para audio
  frente al resto del contenido: el control es **posterior, por reportes**, igual que diálogos,
  textos o reseñas (`specs/17-moderacion-de-contenido.md` §1).
- El reparto de responsabilidad es explícito en los Términos de Servicio: el **creador** responde
  de todo el contenido de su sala (lo haya subido o generado con las herramientas de la
  plataforma) y de que sea lícito; el **organizador** de un evento debe revisar el contenido de una
  sala (incluidos audio y vídeo) antes de usarla con su grupo, especialmente si hay menores.
- Los TOS siguen prohibiendo voces de terceros sin consentimiento; el creador declara tener los
  derechos al subir (ver `specs/18-legal-rgpd-y-menores.md` §2). Esa declaración ya no se verifica
  antes de publicar: los reportes de usuarios son el mecanismo de control.
- Los audios `pending` de antes de esta decisión quedaron utilizables (`approved`); los ya
  `rejected` por la extinta cola humana se conservan inutilizables (decisión humana ya tomada, no
  se libera).

## 5. Titularidad del audio generado (abierto)

La titularidad de contenido generado por IA depende de los términos de servicio de ElevenLabs
como proveedor subyacente. **Punto explícito a revisar con asesoría antes de lanzar la función**:
no se puede asumir titularidad plena solo por haberlo generado; hay que leer los TOS vigentes de
ElevenLabs y reflejar sus condiciones en la licencia UGC de audio (que puede no ser idéntica a la
de contenido escrito). Ver `specs/18-legal-rgpd-y-menores.md` §2.3.

## 6. Dependencias

- `specs/14-modelo-de-datos-sql.md` §4 — ledger.
- `specs/17-moderacion-de-contenido.md` — moderación posterior por reportes.
- `specs/18-legal-rgpd-y-menores.md` — titularidad y DPA de ElevenLabs como subprocesador.
