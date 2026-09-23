/**
 * Servicios de dominio — única lógica invocada por tRPC (UI), REST, MCP y
 * Colyseus (ADR-010/022). Todos los servicios reciben un `actor` explícito y
 * sus dependencias se inyectan, de modo que se testean sin infraestructura.
 */
export * from "./actor";
export * from "./catalog";
export * from "./catalog-listing";
export * from "./reviews";
export * from "./reviews-prisma-store";
export * from "./room-package-repository";
export * from "./room-draft";
export * from "./room-draft-prisma-store";
export * from "./admin";
export * from "./platform-settings";
export * from "./pricing-tiers";
export * from "./admin-prisma-store";
export * from "./audio-assets";
export * from "./audio-assets-prisma-store";
export * from "./room-publish";
export * from "./room-publish-prisma-store";
export * from "./events";
export * from "./events-prisma-store";
export * from "./access-keys";
export * from "./access-keys-prisma-store";
export * from "./join-token";
export * from "./redeem";
export * from "./room-license";
export * from "./room-license-prisma-store";
export * from "./invitations";
export * from "./invitations-prisma-store";
export * from "./access-key-cards";
export * from "./access-key-cards-pdf";
export * from "./access-key-cards-prisma-store";
