/**
 * Known MCP servers an operator can add without hand-typing a connection.
 *
 * Data, not components: adding a second entry should be an edit to this array,
 * not a new dialog. The wizard reads `auth` to decide what to ask for.
 *
 * ## Why every entry here is remote
 *
 * The obvious catalog — `npx -y @modelcontextprotocol/server-*` — is stdio, and
 * stdio cannot run in this backend on Windows. psycopg's async pool requires a
 * SelectorEventLoop; asyncio can only spawn subprocesses on a ProactorEventLoop.
 * A process cannot have both, so a backend configured for Postgres cannot launch
 * a stdio server at all (see assert_stdio_supported in backend/app/mcp/config.py,
 * which raises that as a legible error rather than a bare NotImplementedError).
 *
 * Offering entries that can never connect would be a worse experience than
 * offering none, so the catalog carries hosted servers only.
 */

import type { CredentialProvider } from "@/lib/credential-types";
import type { McpTransport } from "@/lib/registry-types";

export type CatalogAuth = {
  /** The only kind today. A server needing no auth would simply omit `auth`. */
  kind: "credential";
  /** Which vault entries are offered, and what a new one is created as. */
  provider: CredentialProvider;
  /** Named in the wizard so the operator can scope the token correctly. */
  scopes: string[];
  /** Where to create the token. Opened in a new tab. */
  tokenUrl: string;
  /** Background reading, linked but not required. */
  docsUrl: string;
};

export type CatalogEntry = {
  id: string;
  /** Becomes `mcp_servers.name`, and the `MCP · {name}` tool group after it. */
  name: string;
  title: string;
  description: string;
  /** What the server does, in the operator's terms. Shown in the wizard. */
  summary: string[];
  transport: McpTransport;
  url: string;
  auth: CatalogAuth;
};

export const MCP_CATALOG: CatalogEntry[] = [
  {
    id: "github",
    name: "github",
    title: "GitHub",
    description: "Repositories, issues and pull requests, as agent tools",
    summary: [
      "Search code, read files and browse repositories you can access",
      "Read, open and comment on issues and pull requests",
      "Scoped entirely by the token you supply — the server can do no more than your PAT allows",
    ],
    transport: "http",
    // GitHub's hosted server. Remote, so it is unaffected by the stdio
    // limitation described at the top of this file.
    url: "https://api.githubcopilot.com/mcp/",
    auth: {
      kind: "credential",
      provider: "github",
      scopes: ["repo", "read:org", "read:user"],
      tokenUrl: "https://github.com/settings/personal-access-tokens/new",
      docsUrl: "https://docs.github.com/en/copilot/using-github-copilot/coding-agent/mcp",
    },
  },
];

export function catalogEntry(id: string): CatalogEntry | undefined {
  return MCP_CATALOG.find((entry) => entry.id === id);
}
