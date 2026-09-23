import { z } from "zod";
import { defineTool, READ_ONLY } from "./define";

/** Fase E — catálogo de plantillas con sus esquemas (specs/10 §2). */
export const getTemplateCatalogTool = defineTool({
  name: "get_template_catalog",
  title: "Catálogo de plantillas",
  description:
    "Devuelve el catálogo de plantillas de puzzle con el esquema de su configuración (las configs válidas para add_puzzle).",
  phase: "query",
  ticket: "4.2",
  inputSchema: z.object({}),
  annotations: READ_ONLY,
});
