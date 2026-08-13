import { auth, signIn } from "../../../lib/auth";
import { CreateLeagueForm } from "./create-league-form";

// Milestone 2.1 manual-verification page: minimal, unstyled, just enough to
// exercise POST /api/leagues as an authenticated user.
export default async function NewLeaguePage() {
  const session = await auth();

  if (!session?.user) {
    return (
      <main>
        <p>Sign in to create a league.</p>
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
      <h1>Create a league</h1>
      <CreateLeagueForm />
    </main>
  );
}
