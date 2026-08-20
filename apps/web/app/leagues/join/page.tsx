import { auth, signIn } from "../../../lib/auth";
import { JoinLeagueForm } from "./join-league-form";

// Milestone 2.2 manual-verification page: minimal, unstyled, just enough to
// exercise POST /api/leagues/join as an authenticated user.
export default async function JoinLeaguePage() {
  const session = await auth();

  if (!session?.user) {
    return (
      <main>
        <p>Sign in to join a league.</p>
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

  return (
    <main>
      <h1>Join a league</h1>
      <JoinLeagueForm />
    </main>
  );
}
