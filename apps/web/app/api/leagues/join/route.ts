import { auth } from "../../../../lib/auth";
import {
  AlreadyMemberError,
  JoinConflictError,
  LeagueFullError,
  LeagueNotFoundError,
} from "../../../../lib/leagues/errors";
import { joinLeague } from "../../../../lib/leagues/join-league";
import { joinLeagueInputSchema } from "../../../../lib/leagues/schema";

export async function POST(request: Request) {
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

  const parsed = joinLeagueInputSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const result = await joinLeague(parsed.data.inviteCode, session.user.id);
    return Response.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof LeagueNotFoundError) {
      return Response.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof AlreadyMemberError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof LeagueFullError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof JoinConflictError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}
