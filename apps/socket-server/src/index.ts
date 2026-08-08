import { createServer } from "node:http";
import { SHARED_PACKAGE_NAME } from "@fdm/shared";
import { DATABASE_PACKAGE_NAME } from "@fdm/database";

const port = process.env.PORT ?? 4000;

const server = createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/plain" });
  res.end("fantasy-draft-machine socket server placeholder\n");
});

server.listen(port, () => {
  console.log(
    `socket-server placeholder listening on port ${port} (linked: ${SHARED_PACKAGE_NAME}, ${DATABASE_PACKAGE_NAME})`,
  );
});
