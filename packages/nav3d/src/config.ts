/** Parámetros de la navmesh (specs/27 §5.2): fijos e iguales en cliente y servidor. Unidades: metros. */
export const NAV3D = {
  cellSize: 0.15,
  cellHeight: 0.1,
  agentRadius: 0.3,
  agentHeight: 1.8,
  agentMaxClimb: 0.25,
  agentMaxSlopeDeg: 45,
  /** Tolerancia al ajustar un punto pedido a la navmesh. */
  snapPlan: 0.35,
  snapHeight: 0.5,
} as const;

/** `NAV3D` en las unidades de recast (algunos parámetros van en celdas). */
export function recastConfig() {
  return {
    cs: NAV3D.cellSize,
    ch: NAV3D.cellHeight,
    walkableSlopeAngle: NAV3D.agentMaxSlopeDeg,
    walkableRadius: Math.ceil(NAV3D.agentRadius / NAV3D.cellSize),
    walkableHeight: Math.ceil(NAV3D.agentHeight / NAV3D.cellHeight),
    walkableClimb: Math.floor(NAV3D.agentMaxClimb / NAV3D.cellHeight),
  };
}
