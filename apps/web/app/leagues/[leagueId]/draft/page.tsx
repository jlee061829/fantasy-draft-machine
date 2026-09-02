import { getDraftState } from "@fdm/database";
import { notFound } from "next/navigation";
import { auth, signIn } from "../../../../lib/auth";
import { DraftRoomClient } from "./DraftRoomClient";

// Auth-gate and notFound() collapse mirror the league detail page
// (app/leagues/[leagueId]/page.tsx): nonexistent league and authenticated
// non-member both resolve to notFound() via getDraftState's own null
// collapse, so this page never branches on which of those two occurred.
// currentUserId is passed down so DraftRoomClient can derive "your turn"
// from authoritative state + authenticated identity without a second,
// client-side session fetch (Milestone 4.2).
export default async function DraftRoomPage({
  params,
}: {
  params: Promise<{ leagueId: string }>;
}) {
  const session = await auth();

  if (!session?.user?.id) {
    return (
      <main>
        <p>Sign in to view this draft room.</p>
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

  const { leagueId } = await params;
  const initialState = await getDraftState(leagueId, session.user.id);

  if (!initialState) {
    notFound();
  }

  return (
    <DraftRoomClient
      leagueId={leagueId}
      currentUserId={session.user.id}
      initialState={initialState}
    />
  );
}
