import { auth } from "../../../../../../lib/auth";
import { fillOpenLeagueSlotsWithBots } from "../../../../../../lib/leagues/fill-bots";
import { DraftAlreadyStartedError, LeagueNotAccessibleError, NotLeagueOwnerError } from "@fdm/database";

// No request body is read or validated: every field this mutation needs
// (which slots are open, what to name the bots it creates) is server-
// derived from locked, authoritative membership state — there is nothing
// for a client to legitimately supply, so there is no schema to reject an
// arbitrary body against. A request body, if one is sent, is simply never
// parsed.
export async function POST(request: Request, ctx: RouteContext<"/api/leagues/[leagueId]/bots/fill">) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { leagueId } = await ctx.params;

  try {
    const result = await fillOpenLeagueSlotsWithBots(leagueId, session.user.id);
    return Response.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof LeagueNotAccessibleError) {
      return Response.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof NotLeagueOwnerError) {
      return Response.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof DraftAlreadyStartedError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}
