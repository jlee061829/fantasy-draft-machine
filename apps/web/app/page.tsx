import { SHARED_PACKAGE_NAME } from "@fdm/shared";
import { DATABASE_PACKAGE_NAME } from "@fdm/database";

export default function HomePage() {
  return (
    <main>
      <h1>Fantasy Draft Machine</h1>
      <p>Workspace scaffold online.</p>
      <p>
        Linked packages: {SHARED_PACKAGE_NAME}, {DATABASE_PACKAGE_NAME}
      </p>
    </main>
  );
}
