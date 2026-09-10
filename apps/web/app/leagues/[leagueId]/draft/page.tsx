import type { DraftStateResult } from "@fdm/shared";
import Link from "next/link";
import { notFound } from "next/navigation";
import { auth, signIn } from "../../../../lib/auth";
import { getLeagueDetail } from "../../../../lib/leagues/get-league-detail";
import { getAvailablePlayers } from "../../../../lib/players/get-available-players";
import { AvailablePlayersPanel } from "./AvailablePlayersPanel";
import { DraftBoard } from "./DraftBoard";
import { FillBotsForm } from "./fill-bots-form";
import { RemoveBotsForm } from "./remove-bots-form";
import { StartDraftForm } from "./start-draft-form";

// Milestone 4.5: the stable "about this draft" page. It never opens a
// Socket.IO connection (that's exclusively the live room's job, at
// /leagues/[leagueId]/draft/room) and never redirects away based on Draft
// status — instead it renders one of three bodies in place, so a bookmark
// to this URL stays useful before, during, and after the draft.
//
// Data source: getLeagueDetail alone. It already carries everything this
// page needs — league settings, ownerId (for commissioner detection),
// draftSlot-ordered members, and (as of this milestone) draft.status — so
// no second query (e.g. getDraftState) is needed here. getDraftState
// remains the live room's data source; this page's needs are simpler
// (no picks, no currentUserId/turnDeadline) and are fully covered by the
// existing, now slightly-widened LeagueDetailResult DTO.
//
// Commissioner detection is `session.user.id === detail.league.ownerId` —
// the same authority source every other commissioner-only UI in this app
// already uses (StartDraftForm's isFull gating, the settings/reorder forms
// on the league-detail page). This is presentation-only, exactly like those
// existing usages: the actual POST /api/leagues/[leagueId]/draft endpoint
// re-derives and re-checks ownership server-side on its own, so a UI bug
// here could at most mis-render a button, never bypass authorization.
export default async function DraftPage({
  params,
}: {
  params: Promise<{ leagueId: string }>;
}) {
  const session = await auth();

  if (!session?.user?.id) {
    return (
      <main>
        <p>Sign in to view this draft.</p>
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

  const currentUserId = session.user.id;
  const { leagueId } = await params;
  const detail = await getLeagueDetail(leagueId, currentUserId);

  if (!detail) {
    notFound();
  }

  const { league, members } = detail;
  const isCommissioner = currentUserId === league.ownerId;

  // A Draft exists: this page steps back to a compact summary + a link into
  // the live room, rather than continuing to show pre-draft planning UI
  // that no longer reflects reality. Any non-null status that isn't
  // COMPLETE (in practice only ACTIVE — PENDING/PAUSED are not produced by
  // the current product, see CLAUDE.md) is treated as "in progress",
  // mirroring draft-room-helpers.ts's own defensive getDraftPhase fallback.
  if (detail.draft) {
    const isComplete = detail.draft.status === "COMPLETE";
    return (
      <main>
        <h1>{league.name}</h1>
        <p>{isComplete ? "Draft complete." : "Draft in progress."}</p>
        <p>
          <Link href={`/leagues/${league.id}/draft/room`}>
            {isComplete ? "View Draft Room" : "Join Draft Room"}
          </Link>
        </p>
      </main>
    );
  }

  // No Draft yet: the full pre-draft planning/viewing experience.
  const players = await getAvailablePlayers(league.scoringFormat);

  // A minimal DraftStateResult-shaped value, built from the same
  // LeagueDetailResult fields already fetched above (draft: null and
  // picks: [] are simply true pre-draft) — this lets DraftBoard, the exact
  // same component the live room uses, render the empty board with zero
  // duplicated snake/linear logic and zero second board implementation.
  const boardState: DraftStateResult = {
    league: {
      id: league.id,
      name: league.name,
      rosterSize: league.rosterSize,
      teamCount: league.teamCount,
      scoringFormat: league.scoringFormat,
      draftType: league.draftType,
      timerSeconds: league.timerSeconds,
    },
    members,
    draft: null,
    picks: [],
  };

  const isFull = members.length === league.teamCount;
  const botCount = members.filter((member) => member.participantType === "BOT").length;
  const openSlotCount = league.teamCount - members.length;

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: 16, fontFamily: "sans-serif" }}>
      <h1 style={{ marginBottom: 4 }}>{league.name}</h1>
      <p style={{ margin: "4px 0", color: "#57606a" }}>
        {league.draftType} draft · {league.rosterSize} rounds · {league.timerSeconds}s timer ·{" "}
        {league.scoringFormat} scoring
      </p>

      <h2>Draft Order</h2>
      <p style={{ margin: "4px 0", color: "#57606a", fontSize: 13 }}>
        {league.draftType === "SNAKE"
          ? "Snake draft — the order reverses at the end of every round."
          : "Linear draft — the same order repeats every round."}
      </p>
      <ol>
        {members.map((member) => (
          <li key={member.membershipId}>
            {member.name}
            {member.participantType === "BOT" ? " (BOT)" : ""}
            {member.userId === currentUserId ? " (you)" : ""}
            {member.userId === league.ownerId ? " (commissioner)" : ""}
          </li>
        ))}
      </ol>

      {isCommissioner ? (
        <>
          {botCount > 0 && (
            <p style={{ margin: "4px 0", color: "#57606a" }}>
              {members.length}/{league.teamCount} managers joined — {botCount} CPU manager
              {botCount === 1 ? "" : "s"}
            </p>
          )}
          {/* Phase 5.4: the first production control that can create a BOT
              LeagueMember. Only shown while the league isn't full yet — once
              full, StartDraftForm's own enabled button takes over and
              RemoveBotsForm (below) is the only bot-management action left. */}
          {!isFull && <FillBotsForm leagueId={league.id} openSlotCount={openSlotCount} />}
          <StartDraftForm
            leagueId={league.id}
            isFull={isFull}
            membersCount={members.length}
            teamCount={league.teamCount}
          />
          {botCount > 0 && <RemoveBotsForm leagueId={league.id} />}
          {/* Discoverability fix: the existing reorder UI (MemberOrderForm)
              lives on the league-detail page, not here — this page never
              duplicates it. This link is the whole fix: it makes the
              already-working Fill Bots -> reorder -> Start Draft flow
              (verified end to end at the service layer) reachable without
              the commissioner having to already know that page exists. Only
              rendered here, in the commissioner branch of the no-Draft-yet
              body — never in the ACTIVE/COMPLETE summary branch above,
              which returns before this code is reached, and never for a
              non-commissioner, since that's the sibling branch below. */}
          <p style={{ margin: "4px 0" }}>
            <Link href={`/leagues/${league.id}`}>Manage draft order</Link>
          </p>
        </>
      ) : (
        <p>
          The commissioner hasn't started the draft yet — {members.length}/{league.teamCount}{" "}
          joined.
        </p>
      )}

      <h2>Draft Board</h2>
      <DraftBoard state={boardState} currentUserId={currentUserId} />

      <div style={{ marginTop: 16 }}>
        <AvailablePlayersPanel players={players} draftedPlayerIds={new Set()} />
      </div>
    </main>
  );
}
