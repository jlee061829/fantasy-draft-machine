import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@fdm/database";
import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import { env } from "./env";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "database" },
  secret: env.AUTH_SECRET,
  providers: [
    GitHub({
      clientId: env.AUTH_GITHUB_ID,
      clientSecret: env.AUTH_GITHUB_SECRET,
    }),
  ],
});
