import { SHARED_PACKAGE_NAME } from "@fdm/shared";
import { DATABASE_PACKAGE_NAME } from "@fdm/database";
import { auth, signIn, signOut } from "../lib/auth";

export default async function HomePage() {
  const session = await auth();

  return (
    <main>
      <h1>Fantasy Draft Machine</h1>
      <p>Workspace scaffold online.</p>
      <p>
        Linked packages: {SHARED_PACKAGE_NAME}, {DATABASE_PACKAGE_NAME}
      </p>
      {session?.user ? (
        <>
          <p>Signed in as {session.user.name ?? session.user.email}</p>
          <form
            action={async () => {
              "use server";
              await signOut();
            }}
          >
            <button type="submit">Sign out</button>
          </form>
        </>
      ) : (
        <form
          action={async () => {
            "use server";
            await signIn("github");
          }}
        >
          <button type="submit">Sign in with GitHub</button>
        </form>
      )}
    </main>
  );
}
