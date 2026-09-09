import { getDraftState } from "@fdm/database";
import { notFound, redirect } from "next/navigation";
import { auth, signIn } from "../../../../../lib/auth";
import { getAvailablePlayers } from "../../../../../lib/players/get-available-players";
import { DraftRoomClient } from "../DraftRoomClient";

// Milestone 4.5: the live draft room, split out from the combined
// /leagues/[leagueId]/draft page that previously always mounted
// DraftRoomClient (and its Socket.IO connection) regardless of whether a
// Draft existed yet. This route is the only place that ever opens the
// socket connection — the pre-draft page at /leagues/[leagueId]/draft never
// does.
//
// Auth-gate and notFound() collapse mirror every other league page:
// nonexistent league and authenticated non-member both resolve to
// notFound() via getDraftState's own null collapse. currentUserId is passed
// down so DraftRoomClient can derive "your turn" from authoritative state +
// authenticated identity without a second, client-side session fetch
// (unchanged from Milestone 4.2).
export default async function LiveDraftRoomPage({
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

  // Someone navigating (or with a stale link) straight to the live room
  // before the commissioner has started the draft has nothing live to join
  // yet — send them to the pre-draft page, which is the single canonical
  // place that "no Draft yet" state is rendered (see its own page.tsx).
  if (!initialState.draft) {
    redirect(`/leagues/${leagueId}/draft`);
  }

  // Player-pool fetch only runs once membership is already established by
  // getDraftState above — getAvailablePlayers has no auth/membership check
  // of its own (see its own doc comment) because it needs none: it takes no
  // leagueId/userId, only the league's own scoringFormat.
  const players = await getAvailablePlayers(initialState.league.scoringFormat);

  return (
    <DraftRoomClient
      leagueId={leagueId}
      currentUserId={session.user.id}
      initialState={initialState}
      players={players}
    />
  );
}
