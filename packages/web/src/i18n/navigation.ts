import { createNavigation } from "next-intl/navigation";
import { routing } from "./routing";

/**
 * Envoltorios de navegación que respetan el routing de locales: `Link` y el
 * router añaden el prefijo del idioma activo automáticamente.
 */
export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);
