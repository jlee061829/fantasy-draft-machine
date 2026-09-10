import { auth } from "../../../../../lib/auth";
import { removeBotLeagueMembers } from "../../../../../lib/leagues/remove-bots";
import { DraftAlreadyStartedError, LeagueNotAccessibleError, NotLeagueOwnerError } from "@fdm/database";

// No request body is read or validated — see the fill route's comment for
// why: there is nothing for a client to legitimately supply here either.
export async function DELETE(request: Request, ctx: RouteContext<"/api/leagues/[leagueId]/bots">) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { leagueId } = await ctx.params;

  try {
    const result = await removeBotLeagueMembers(leagueId, session.user.id);
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
