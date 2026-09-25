/**
 * Comprobación de exhaustividad en tiempo de compilación (D-21): si el
 * `switch` sobre un tipo unión no cubre todos sus casos, TypeScript rechaza
 * el `value: never` en la llamada. En tiempo de ejecución (p. ej. un paquete
 * publicado con una versión de esquema más nueva que este build) lanza en vez
 * de ignorar el caso en silencio.
 */
export function assertNever(value: never, context: string): never {
  throw new Error(`${context}: caso no manejado ${JSON.stringify(value)}`);
}
