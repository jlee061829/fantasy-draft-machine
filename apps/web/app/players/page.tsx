import { prisma, ScoringFormat } from "@fdm/database";
import { auth, signIn } from "../../lib/auth";

// Phase 1 exit-criterion verification: proves the app can query seeded
// players with ADP attached through @fdm/database's Prisma client. Remove
// once Phase 4's real available-players panel replaces it.
export default async function PlayersPage() {
  const session = await auth();

  if (!session?.user) {
    return (
      <main>
        <p>Sign in to view seeded players.</p>
        <form
          action={async () => {
            "use server";
            await signIn("github");
          }}
        >
          <button type="submit">Sign in with GitHub</button>
        </form>
      </main>
    );
  }

  const playerAdps = await prisma.playerAdp.findMany({
    where: {
      format: ScoringFormat.PPR,
      adp: { not: null },
    },
    include: { player: true },
    orderBy: { adp: "asc" },
    take: 25,
  });

  return (
    <main>
      <h1>Top 25 players by PPR ADP</h1>
      <ol>
        {playerAdps.map((entry) => (
          <li key={entry.id}>
            {entry.player.fullName} — {entry.player.position} —{" "}
            {entry.player.nflTeam ?? "FA"} — PPR ADP: {entry.adp}
          </li>
        ))}
      </ol>
    </main>
  );
}
