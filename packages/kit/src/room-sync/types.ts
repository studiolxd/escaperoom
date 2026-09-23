/**
 * A Yjs draft update produced by ONE process (an `editor-sync` instance
 * applying a WebSocket client's edit, or the REST/MCP writers persisting
 * outside any live session), broadcast so every `editor-sync` process that
 * has that room loaded can apply it to its in-memory doc and forward it to
 * its own connected clients — no reload needed (specs/09 §2).
 */
export type DraftUpdateEvent = {
  roomId: string;
  /** Raw Yjs update bytes (the same ones persisted in `roomUpdate`). */
  update: Uint8Array;
  /** `null` for updates from the MCP or another process without a user session. */
  authorId: string | null;
  /** Id of the process that produced this event; subscribers use it to ignore their own echo. */
  originId: string;
};

/** Wire format: `update` travels as base64 inside JSON (Redis pub/sub is text). */
export type DraftUpdateWireEvent = Omit<DraftUpdateEvent, "update"> & { update: string };
