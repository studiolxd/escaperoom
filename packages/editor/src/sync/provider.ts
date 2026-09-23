import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import { ObservableV2 } from "lib0/observable";
import * as awarenessProtocol from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import type * as Y from "yjs";
import {
  MESSAGE_AWARENESS,
  MESSAGE_QUERY_AWARENESS,
  MESSAGE_RESTORE,
  MESSAGE_SYNC,
  encodeRestoreRequest,
  readRestorePayload,
  roomSyncUrl,
  type RestoreRequest,
  type RestoreResponse,
} from "./protocol";

/** `WebSocket.OPEN`, sin depender de que exista el `WebSocket` global. */
const WS_OPEN = 1;

/**
 * Proveedor cliente del WebSocket de edición (specs/09 §2). Headless: conecta
 * un `Y.Doc` y una `Awareness` al servidor de sincronización y no sabe nada de
 * la UI (la UI del editor es el ticket 3.1; el store de Zustand se conecta al
 * doc, no a este proveedor).
 *
 * - **Autosave continuo:** cada transacción local se envía en cuanto hay
 *   conexión; el servidor la persiste. No hay "guardar".
 * - **Offline:** sin conexión el doc se sigue editando en memoria; al
 *   reconectar, el intercambio sync step 1/2 manda al servidor lo que le falta
 *   y viceversa (merge CRDT, sin "último gana").
 * - **Reconexión** automática con backoff exponencial.
 */
export type EditorSyncStatus = "disconnected" | "connecting" | "connected";

export type EditorSyncProviderEvents = {
  status: (status: EditorSyncStatus) => void;
  /** `true` tras recibir el estado del servidor (sync step 2); `false` al desconectar. */
  synced: (synced: boolean) => void;
  /** El servidor cerró o rechazó la conexión (p. ej. handshake 401/403). */
  "connection-close": (event: { code: number; reason: string }) => void;
};

export type EditorSyncProviderOptions = {
  /** Base del servidor, p. ej. `wss://editor-sync.example.com`. */
  url: string;
  roomId: string;
  doc: Y.Doc;
  /** Awareness propia (por defecto se crea una sobre `doc`). */
  awareness?: awarenessProtocol.Awareness;
  /** Conectar al crear (por defecto `true`). */
  connect?: boolean;
  /**
   * Fábrica del socket (por defecto el `WebSocket` global). En Node/tests
   * permite usar `ws` con cabeceras de sesión.
   */
  createWebSocket?: (url: string) => WebSocket;
  /** Backoff de reconexión: mínimo y máximo en ms. */
  minReconnectDelayMs?: number;
  maxReconnectDelayMs?: number;
};

type PendingRestore = {
  resolve: (value: { changed: boolean }) => void;
  reject: (err: Error) => void;
};

/** Error de una restauración rechazada por el servidor. */
export class EditorSyncRestoreError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "EditorSyncRestoreError";
    this.code = code;
  }
}

export class EditorSyncProvider extends ObservableV2<EditorSyncProviderEvents> {
  readonly doc: Y.Doc;
  readonly awareness: awarenessProtocol.Awareness;
  readonly url: string;
  status: EditorSyncStatus = "disconnected";
  synced = false;

  private socket: WebSocket | null = null;
  private shouldConnect = false;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private nextRequestId = 1;
  private readonly pendingRestores = new Map<number, PendingRestore>();
  private readonly createWebSocket: (url: string) => WebSocket;
  private readonly minReconnectDelayMs: number;
  private readonly maxReconnectDelayMs: number;
  private readonly ownsAwareness: boolean;

  constructor(options: EditorSyncProviderOptions) {
    super();
    this.doc = options.doc;
    this.ownsAwareness = !options.awareness;
    this.awareness = options.awareness ?? new awarenessProtocol.Awareness(options.doc);
    this.url = roomSyncUrl(options.url, options.roomId);
    this.createWebSocket = options.createWebSocket ?? ((url) => new WebSocket(url));
    this.minReconnectDelayMs = options.minReconnectDelayMs ?? 100;
    this.maxReconnectDelayMs = options.maxReconnectDelayMs ?? 10_000;

    this.doc.on("update", this.onDocUpdate);
    this.awareness.on("update", this.onAwarenessUpdate);
    if (options.connect ?? true) this.connect();
  }

  /** Resuelve cuando el doc local ya tiene el estado del servidor. */
  whenSynced(): Promise<void> {
    if (this.synced) return Promise.resolve();
    return new Promise((resolve) => {
      const onSynced = (synced: boolean) => {
        if (!synced) return;
        this.off("synced", onSynced);
        resolve();
      };
      this.on("synced", onSynced);
    });
  }

  connect(): void {
    this.shouldConnect = true;
    if (this.socket || this.reconnectTimer) return;
    this.openSocket();
  }

  /** Corta la conexión (modo offline); el doc sigue editable y se sincroniza al volver. */
  disconnect(): void {
    this.shouldConnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const socket = this.socket;
    if (!socket) return;
    if (socket.readyState === WS_OPEN) {
      // Avisar a los demás de que este cliente deja de estar presente.
      this.sendAwareness([this.doc.clientID], true);
    }
    this.handleClose(socket, 1000, "client disconnect");
    socket.close();
  }

  override destroy(): void {
    this.disconnect();
    this.doc.off("update", this.onDocUpdate);
    this.awareness.off("update", this.onAwarenessUpdate);
    if (this.ownsAwareness) this.awareness.destroy();
    super.destroy();
  }

  /**
   * Pide al servidor restaurar el draft a un punto del historial. La
   * restauración llega a todos los clientes como un update más.
   */
  restore(target: RestoreRequest): Promise<{ changed: boolean }> {
    const socket = this.socket;
    if (!socket || socket.readyState !== WS_OPEN) {
      return Promise.reject(new EditorSyncRestoreError("OFFLINE", "Sin conexión con el servidor"));
    }
    const requestId = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      this.pendingRestores.set(requestId, { resolve, reject });
      this.send(encodeRestoreRequest(requestId, target));
    });
  }

  private readonly onDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === this) return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    this.send(encoding.toUint8Array(encoder));
  };

  private readonly onAwarenessUpdate = (
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ) => {
    if (origin === this) return;
    this.sendAwareness([...added, ...updated, ...removed]);
  };

  private sendAwareness(clients: number[], asRemoved = false): void {
    let update = awarenessProtocol.encodeAwarenessUpdate(this.awareness, clients);
    if (asRemoved) {
      update = awarenessProtocol.modifyAwarenessUpdate(update, () => null);
    }
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(encoder, update);
    this.send(encoding.toUint8Array(encoder));
  }

  private send(message: Uint8Array): void {
    // Los encoders de lib0 siempre producen bytes sobre un `ArrayBuffer` normal.
    if (this.socket?.readyState === WS_OPEN) this.socket.send(message as Uint8Array<ArrayBuffer>);
  }

  private setStatus(status: EditorSyncStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.emit("status", [status]);
  }

  private setSynced(synced: boolean): void {
    if (this.synced === synced) return;
    this.synced = synced;
    this.emit("synced", [synced]);
  }

  private openSocket(): void {
    this.setStatus("connecting");
    const socket = this.createWebSocket(this.url);
    socket.binaryType = "arraybuffer";
    this.socket = socket;

    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.reconnectAttempts = 0;
      this.setStatus("connected");
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeSyncStep1(encoder, this.doc);
      this.send(encoding.toUint8Array(encoder));
      if (this.awareness.getLocalState() !== null) this.sendAwareness([this.doc.clientID]);
    };
    socket.onmessage = (event: MessageEvent) => {
      if (this.socket !== socket) return;
      this.handleMessage(new Uint8Array(event.data as ArrayBuffer));
    };
    socket.onclose = (event: CloseEvent) => this.handleClose(socket, event.code, event.reason);
    // `onerror` siempre va seguido de `onclose`, que es quien reconecta.
    socket.onerror = () => undefined;
  }

  private handleMessage(data: Uint8Array): void {
    const decoder = decoding.createDecoder(data);
    const type = decoding.readVarUint(decoder);
    switch (type) {
      case MESSAGE_SYNC: {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        const syncType = syncProtocol.readSyncMessage(decoder, encoder, this.doc, this);
        if (encoding.length(encoder) > 1) this.send(encoding.toUint8Array(encoder));
        if (syncType === syncProtocol.messageYjsSyncStep2) this.setSynced(true);
        return;
      }
      case MESSAGE_AWARENESS:
        awarenessProtocol.applyAwarenessUpdate(
          this.awareness,
          decoding.readVarUint8Array(decoder),
          this,
        );
        return;
      case MESSAGE_QUERY_AWARENESS:
        this.sendAwareness([...this.awareness.getStates().keys()]);
        return;
      case MESSAGE_RESTORE: {
        const { requestId, payload } = readRestorePayload(decoder);
        const pending = this.pendingRestores.get(requestId);
        if (!pending) return;
        this.pendingRestores.delete(requestId);
        const response = payload as RestoreResponse;
        if (response.ok) pending.resolve({ changed: response.changed });
        else pending.reject(new EditorSyncRestoreError(response.code, response.message));
        return;
      }
      default:
        return;
    }
  }

  private handleClose(socket: WebSocket, code: number, reason: string): void {
    if (this.socket !== socket) return;
    socket.onopen = null;
    socket.onmessage = null;
    socket.onclose = null;
    this.socket = null;
    this.setSynced(false);
    this.setStatus("disconnected");
    this.emit("connection-close", [{ code, reason }]);

    // Los estados de awareness remotos dejan de ser fiables sin conexión.
    const remote = [...this.awareness.getStates().keys()].filter((id) => id !== this.doc.clientID);
    if (remote.length > 0) awarenessProtocol.removeAwarenessStates(this.awareness, remote, this);

    for (const pending of this.pendingRestores.values()) {
      pending.reject(new EditorSyncRestoreError("OFFLINE", "Conexión cerrada"));
    }
    this.pendingRestores.clear();

    if (!this.shouldConnect) return;
    const delay = Math.min(
      this.minReconnectDelayMs * 2 ** this.reconnectAttempts,
      this.maxReconnectDelayMs,
    );
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.shouldConnect) this.openSocket();
    }, delay);
  }
}
