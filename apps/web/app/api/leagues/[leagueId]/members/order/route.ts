import { auth } from "../../../../../../lib/auth";
import {
  DraftAlreadyStartedError,
  LeagueNotAccessibleError,
  NotLeagueOwnerError,
  ReorderConflictError,
  ReorderMembershipMismatchError,
} from "@fdm/database";
import { reorderLeagueMembersInputSchema } from "../../../../../../lib/leagues/schema";
import { reorderLeagueMembers } from "../../../../../../lib/leagues/reorder-league-members";

export async function PUT(
  request: Request,
  ctx: RouteContext<"/api/leagues/[leagueId]/members/order">,
) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid input" }, { status: 400 });
  }

  const parsed = reorderLeagueMembersInputSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { leagueId } = await ctx.params;

  try {
    const result = await reorderLeagueMembers(leagueId, parsed.data, session.user.id);
    return Response.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof LeagueNotAccessibleError) {
      return Response.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof NotLeagueOwnerError) {
      return Response.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof ReorderMembershipMismatchError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof ReorderConflictError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof DraftAlreadyStartedError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}
