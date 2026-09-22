import Link from "next/link";
import { GameShell } from "@/components/game/game-shell";

export default function HomePage() {
  return (
    <main className="relative min-h-dvh bg-background p-4">
      <GameShell />
      <Link
        href="/lobby"
        className="absolute bottom-6 right-6 rounded-full border border-white/15 bg-black/60 px-4 py-2 text-sm text-white backdrop-blur transition-colors hover:bg-black/80"
      >
        Lobby multijugador (0.5) →
      </Link>
    </main>
  );
}
