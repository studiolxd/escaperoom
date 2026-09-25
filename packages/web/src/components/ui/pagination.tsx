import * as React from "react";
import { cn } from "cn";
import { MoreHorizontalIcon } from "lucide-react";

/**
 * Piezas estructurales del paginador (shadcn/ui). Los enlaces en sí se
 * montan en el punto de uso con `Button asChild` + `Link` de `@/i18n/navigation`
 * (i18n de rutas), no con un `<a>` crudo — por eso no se incluye aquí un
 * `PaginationLink` genérico como en el registro original.
 */
function Pagination({ className, ...props }: React.ComponentProps<"nav">) {
  return (
    <nav
      role="navigation"
      aria-label="pagination"
      data-slot="pagination"
      className={cn("mx-auto flex w-full justify-center", className)}
      {...props}
    />
  );
}

function PaginationContent({ className, ...props }: React.ComponentProps<"ul">) {
  return (
    <ul
      data-slot="pagination-content"
      className={cn("flex items-center gap-0.5", className)}
      {...props}
    />
  );
}

function PaginationItem({ ...props }: React.ComponentProps<"li">) {
  return <li data-slot="pagination-item" {...props} />;
}

function PaginationEllipsis({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      aria-hidden
      data-slot="pagination-ellipsis"
      className={cn("flex size-8 items-center justify-center [&_svg:not([class*='size-'])]:size-4", className)}
      {...props}
    >
      <MoreHorizontalIcon />
      <span className="sr-only">…</span>
    </span>
  );
}

export { Pagination, PaginationContent, PaginationEllipsis, PaginationItem };
