/** Emisor mínimo de un solo tipo de evento (sin dependencias del navegador). */
export class Emitter<T> {
  private readonly listeners = new Set<(value: T) => void>();

  on(listener: (value: T) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(value: T): void {
    for (const listener of [...this.listeners]) listener(value);
  }

  clear(): void {
    this.listeners.clear();
  }
}
