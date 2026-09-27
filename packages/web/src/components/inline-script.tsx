/**
 * `<script dangerouslySetInnerHTML>` sin el aviso de Next 16 "Encountered a
 * script tag while rendering React component": en servidor sale como
 * `text/javascript` (se ejecuta durante el parseo del HTML, antes del primer
 * pintado); en cliente, `text/plain` (React ya no debe re-ejecutarlo al
 * hidratar). `suppressHydrationWarning` cubre ese cambio de `type`.
 */
export function InlineScript({
  html,
  nonce,
}: {
  html: string;
  nonce?: string;
}) {
  return (
    <script
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      nonce={nonce}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
