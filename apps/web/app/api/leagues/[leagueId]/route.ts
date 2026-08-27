import { auth } from "../../../../lib/auth";
import {
  DraftAlreadyStartedError,
  LeagueNotAccessibleError,
  NotLeagueOwnerError,
  TeamCountBelowMembershipError,
} from "@fdm/database";
import { updateLeagueSettingsInputSchema } from "../../../../lib/leagues/schema";
import { updateLeagueSettings } from "../../../../lib/leagues/update-league-settings";

export async function PATCH(request: Request, ctx: RouteContext<"/api/leagues/[leagueId]">) {
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

  const parsed = updateLeagueSettingsInputSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { leagueId } = await ctx.params;

  try {
    const result = await updateLeagueSettings(leagueId, parsed.data, session.user.id);
    return Response.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof LeagueNotAccessibleError) {
      return Response.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof NotLeagueOwnerError) {
      return Response.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof TeamCountBelowMembershipError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof DraftAlreadyStartedError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}
