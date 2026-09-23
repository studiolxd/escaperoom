-- 0013_access_key_sent_at — último envío de la invitación por email (ticket 5.6, specs/02 §4.4).
--
-- Sin confirmación obligatoria las claves nacen `active` (5.5) y el envío no
-- cambia su estado (`sent` no es canjeable), así que "¿le llegó el email?"
-- necesita su propia columna. Con confirmación, el envío además lleva la clave
-- de `generated` a `pending_confirmation`. Solo se guarda el instante del último
-- envío correcto: ni el cuerpo del email ni el historial (minimización, specs/18 §3).
ALTER TABLE "accessKey" ADD COLUMN "sentAt" timestamptz;
