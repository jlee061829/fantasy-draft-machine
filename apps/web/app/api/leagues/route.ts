import { auth } from "../../../lib/auth";
import { createLeague } from "../../../lib/leagues/create-league";
import { createLeagueInputSchema } from "../../../lib/leagues/schema";

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

  const parsed = createLeagueInputSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const result = await createLeague(parsed.data, session.user.id);
  return Response.json(result, { status: 201 });
}
