import { DraftAlreadyExistsError, LeagueNotFullError } from "../../../../../lib/drafts/errors";
import { startDraft } from "../../../../../lib/drafts/start-draft";
import { auth } from "../../../../../lib/auth";
import { LeagueNotAccessibleError, NotLeagueOwnerError } from "../../../../../lib/leagues/errors";

export async function POST(request: Request, ctx: RouteContext<"/api/leagues/[leagueId]/draft">) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { leagueId } = await ctx.params;

  try {
    const result = await startDraft(leagueId, session.user.id);
    return Response.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof LeagueNotAccessibleError) {
      return Response.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof NotLeagueOwnerError) {
      return Response.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof DraftAlreadyExistsError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof LeagueNotFullError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}
