import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HaloApiClient } from "../client/halo-api-client.js";
import { errorResult } from "../utils/errors.js";

export function registerRunbookTools(
  server: McpServer,
  client: HaloApiClient
): void {
  server.registerTool("halo_list_runbooks", {
    title: "List Runbooks",
    description:
      "List HaloPSA Integration Runbooks (internally called 'Webhooks'). Use search to filter by name. Returns an array of runbook summaries. Call halo_get_runbook on an id to fetch the full definition — useful as a template for halo_create_runbook.",
    inputSchema: {
      search: z.string().optional().describe("Substring match on runbook name"),
      page_size: z.number().optional().describe("Results per page (default 50)"),
      page_no: z.number().optional().describe("Page number (default 1)"),
    },
  }, async (args) => {
    try {
      const result = await client.getList<Record<string, unknown>>("/Webhook", {
        search: args.search,
        page_size: args.page_size ?? 50,
        page_no: args.page_no ?? 1,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      return errorResult(error);
    }
  });

  server.registerTool("halo_get_runbook", {
    title: "Get Runbook",
    description:
      "Fetch a single HaloPSA Integration Runbook (Webhook) by id, returning its full JSON including variables, steps, events, and all other fields. Useful as a template for halo_create_runbook — clone a similar existing runbook's JSON structure.",
    inputSchema: {
      id: z.string().describe("Runbook UUID"),
    },
  }, async (args) => {
    try {
      const result = await client.get<Record<string, unknown>>(`/Webhook/${args.id}`);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      return errorResult(error);
    }
  });
}
