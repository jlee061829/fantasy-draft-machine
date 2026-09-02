import Link from "next/link";
import { auth, signIn } from "../../lib/auth";
import { getMyLeagues } from "../../lib/leagues/get-my-leagues";

// Navigation page: lists every league the current user is a LeagueMember of,
// which naturally covers both leagues they created (creators always receive
// a LeagueMember row — see createLeague) and leagues they joined. Follows
// the same minimal, unstyled manual-verification style as the other league
// pages in this milestone set.
export default async function MyLeaguesPage() {
  const session = await auth();

  if (!session?.user?.id) {
    return (
      <main>
        <p>Sign in to view your leagues.</p>
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

  const userId = session.user.id;
  const leagues = await getMyLeagues(userId);

  return (
    <main>
      <h1>Your leagues</h1>

      <p>
        <Link href="/leagues/new">Create a league</Link>
        {" | "}
        <Link href="/leagues/join">Join a league</Link>
      </p>

      {leagues.length === 0 ? (
        <p>
          You are not in any leagues yet. <Link href="/leagues/new">Create one</Link> or{" "}
          <Link href="/leagues/join">join one with an invite code</Link>.
        </p>
      ) : (
        <ul>
          {leagues.map((league) => (
            <li key={league.id}>
              <Link href={`/leagues/${league.id}`}>{league.name}</Link>
              {league.ownerId === userId ? " (commissioner)" : ""}
              {" — "}
              {league.teamCount} teams, {league.scoringFormat}, {league.draftType}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
