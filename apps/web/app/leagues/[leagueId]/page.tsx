import { notFound } from "next/navigation";
import { auth, signIn } from "../../../lib/auth";
import { getLeagueDetail } from "../../../lib/leagues/get-league-detail";
import { LeagueSettingsForm } from "./league-settings-form";
import { MemberOrderForm } from "./member-order-form";

// Milestone 2.3 manual-verification page: minimal, unstyled, just enough to
// exercise getLeagueDetail as an authenticated league member. Nonexistent
// league and authenticated-non-member are collapsed to the same notFound()
// on purpose — see getLeagueDetail's doc comment — so this page never
// branches on which of those two cases occurred.
export default async function LeagueDetailPage({
  params,
}: {
  params: Promise<{ leagueId: string }>;
}) {
  const session = await auth();

  if (!session?.user?.id) {
    return (
      <main>
        <p>Sign in to view this league.</p>
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
  const detail = await getLeagueDetail(leagueId, session.user.id);

  if (!detail) {
    notFound();
  }

  const { league, owner, members } = detail;

  return (
    <main>
      <h1>{league.name}</h1>
      <dl>
        <dt>Invite code</dt>
        <dd>{league.inviteCode}</dd>
        <dt>Commissioner</dt>
        <dd>{owner.name}</dd>
        <dt>Roster size</dt>
        <dd>{league.rosterSize}</dd>
        <dt>Team count</dt>
        <dd>{league.teamCount}</dd>
        <dt>Pick timer</dt>
        <dd>{league.timerSeconds}s</dd>
        <dt>Scoring format</dt>
        <dd>{league.scoringFormat}</dd>
        <dt>Draft type</dt>
        <dd>{league.draftType}</dd>
      </dl>

      <h2>Members</h2>
      <ol>
        {members.map((member) => (
          <li key={member.membershipId}>
            Slot {member.draftSlot}: {member.name}
            {member.userId === league.ownerId ? " (commissioner)" : ""}
          </li>
        ))}
      </ol>

      {session.user.id === league.ownerId && (
        <>
          <h2>Commissioner settings</h2>
          <LeagueSettingsForm leagueId={league.id} settings={league} />

          <h2>Draft-slot order</h2>
          <MemberOrderForm leagueId={league.id} members={members} />
        </>
      )}
    </main>
  );
}
