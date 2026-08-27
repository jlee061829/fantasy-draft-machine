import { auth } from "../../../../../../lib/auth";
import { submitPickInputSchema } from "../../../../../../lib/drafts/schema";
import {
  DraftNotActiveError,
  DraftNotFoundError,
  LeagueNotAccessibleError,
  NotOnTheClockError,
  PlayerAlreadyDraftedError,
  PlayerNotFoundError,
  submitPick,
} from "@fdm/database";

export async function POST(
  request: Request,
  ctx: RouteContext<"/api/leagues/[leagueId]/draft/picks">,
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

  const parsed = submitPickInputSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { leagueId } = await ctx.params;

  try {
    const result = await submitPick(leagueId, session.user.id, parsed.data.playerId);
    return Response.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof LeagueNotAccessibleError) {
      return Response.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof DraftNotFoundError) {
      return Response.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof DraftNotActiveError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof NotOnTheClockError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof PlayerNotFoundError) {
      return Response.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof PlayerAlreadyDraftedError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}
