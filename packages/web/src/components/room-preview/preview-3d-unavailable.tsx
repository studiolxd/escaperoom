import { Alert, AlertDescription } from "@/components/ui/alert";

/**
 * Aviso de las previsualizaciones que montan el runtime Phaser directamente
 * (`room-preview`, `world-preview`, lobby del editor) cuando el modelo es 3D:
 * no se monta Phaser con una sala 3D hasta que exista el editor 3D.
 */
export function Preview3DUnavailable({ message }: { message: string }) {
  return (
    <Alert data-testid="preview-3d-unavailable" className="m-4 w-auto">
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}
