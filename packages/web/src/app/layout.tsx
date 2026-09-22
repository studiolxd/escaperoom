import type { ReactNode } from "react";

export const metadata = {
  title: "EscapeRoom Creator",
  description: "Escape rooms online 2D isométricos cooperativos.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
