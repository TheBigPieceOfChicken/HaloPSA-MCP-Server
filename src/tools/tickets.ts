import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HaloApiClient } from "../client/halo-api-client.js";
import type { HaloTicket, HaloAgent, HaloListResponse } from "../client/types.js";
import { paginationSchema } from "../utils/pagination.js";
import { errorResult } from "../utils/errors.js";

type TicketRecord = HaloTicket & Record<string, unknown>;

export function registerTicketTools(
  server: McpServer,
  client: HaloApiClient
): void {
  server.registerTool("halo_list_tickets", {
    title: "List Tickets",
    description:
      "List HaloPSA tickets with optional filtering. Returns paginated results. Use search to filter by keyword, or filter by client_id, agent_id, status_id, etc.",
    inputSchema: {
      ...paginationSchema,
      client_id: z.number().optional().describe("Filter by client ID"),
      agent_id: z.number().optional().describe("Filter by assigned agent ID"),
      status_id: z.number().optional().describe("Filter by status ID"),
      tickettype_id: z.number().optional().describe("Filter by ticket type ID"),
      team_id: z.number().optional().describe("Filter by team ID"),
      site_id: z.number().optional().describe("Filter by site ID"),
      user_id: z.number().optional().describe("Filter by user/contact ID"),
      category_1: z.string().optional().describe("Filter by category 1"),
      open_only: z.boolean().optional().describe("Only return open tickets"),
    },
  }, async (args) => {
    try {
      const result = await client.getList<HaloTicket>(
        "/Tickets",
        {
          page_size: args.page_size ?? 50,
          page_no: args.page_no ?? 1,
          order: args.order,
          orderdesc: args.orderdesc,
          search: args.search,
          client_id: args.client_id,
          agent_id: args.agent_id,
          status_id: args.status_id,
          tickettype_id: args.tickettype_id,
          team_id: args.team_id,
          site_id: args.site_id,
          user_id: args.user_id,
          category_1: args.category_1,
          open_only: args.open_only,
        }
      );
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                record_count: result.record_count,
                tickets: result.records.map((t) => ({
                  id: t.id,
                  summary: t.summary,
                  client_name: t.client_name,
                  agent_name: t.agent_name,
                  status: t.status,
                  priority: t.priority,
                  dateoccurred: t.dateoccurred,
                })),
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      return errorResult(error);
    }
  });

  server.registerTool("halo_get_ticket", {
    title: "Get Ticket",
    description:
      "Get a single HaloPSA ticket by ID. Returns trimmed fields by default. Set include_full_details=true for the complete raw response.",
    inputSchema: {
      ticket_id: z.number().describe("The ticket ID to retrieve"),
      include_full_details: z
        .boolean()
        .optional()
        .describe("Return full raw response instead of trimmed fields (default false)"),
    },
  }, async (args) => {
    try {
      const result = await client.get<TicketRecord>(
        `/Tickets/${args.ticket_id}`,
        { includedetails: true }
      );

      if (args.include_full_details) {
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      const rawDetails = typeof result.details === "string" ? result.details : "";
      const detailsTruncated = rawDetails.length > 4000;
      const details = detailsTruncated ? rawDetails.substring(0, 4000) : rawDetails;

      const trimmed = {
        id: result.id,
        summary: result.summary,
        details,
        details_truncated: detailsTruncated,
        status: result.status,
        status_id: result.status_id,
        priority: result.priority,
        priority_id: result.priority_id,
        client_id: result.client_id,
        client_name: result.client_name,
        user_name: result.user_name,
        agent_name: result.agent_name,
        team: result.team,
        dateoccurred: result.dateoccurred,
        dateclosed: result.dateclosed,
        deadlinedate: result.deadlinedate,
        category_1: result.category_1,
        category_2: result.category_2,
        category_3: result.category_3,
        sla_id: result.sla_id,
        customfields: result.customfields,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(trimmed, null, 2) }],
      };
    } catch (error) {
      return errorResult(error);
    }
  });

  server.registerTool("halo_create_ticket", {
    title: "Create Ticket",
    description:
      "Create a new HaloPSA ticket. At minimum provide summary and tickettype_id. The ticket will be created as the authenticated user (reportedby is set automatically by HaloPSA).",
    inputSchema: {
      summary: z.string().describe("Ticket summary/subject"),
      details: z.string().optional().describe("Ticket description/body"),
      tickettype_id: z.number().describe("Ticket type ID"),
      client_id: z.number().optional().describe("Client ID"),
      site_id: z.number().optional().describe("Site ID"),
      user_id: z.number().optional().describe("User/contact ID"),
      agent_id: z.number().optional().describe("Assign to agent ID"),
      team_id: z.number().optional().describe("Assign to team ID"),
      status_id: z.number().optional().describe("Initial status ID"),
      priority_id: z.number().optional().describe("Priority ID"),
      category_1: z.string().optional().describe("Category level 1"),
      category_2: z.string().optional().describe("Category level 2"),
      category_3: z.string().optional().describe("Category level 3"),
      impact: z.number().optional().describe("Impact level (e.g. 0=unset). Required by some HaloPSA configs"),
      urgency: z.number().optional().describe("Urgency level (e.g. 0=unset). Required by some HaloPSA configs"),
      sla_id: z.number().optional().describe("SLA ID"),
      deadlinedate: z.string().optional().describe("Deadline date (ISO 8601)"),
      dateoccurred: z.string().optional().describe("When the ticket occurred (ISO 8601). Use for backdating tickets to a past date. Defaults to now."),
    },
  }, async (args) => {
    try {
      // Build payload, filtering undefined values but ensuring required fields have defaults
      const payload: Record<string, unknown> = {
        summary: args.summary,
        tickettype_id: args.tickettype_id,
        category_1: args.category_1 ?? "",
        impact: args.impact ?? 1,
        urgency: args.urgency ?? 1,
      };
      // Add optional fields only if provided
      for (const [key, value] of Object.entries(args)) {
        if (value !== undefined && !(key in payload)) {
          payload[key] = value;
        }
      }
      const result = await client.post<HaloTicket>("/Tickets", payload);
      return {
        content: [
          {
            type: "text",
            text: `Ticket created successfully:\n${JSON.stringify(result, null, 2)}`,
          },
        ],
      };
    } catch (error) {
      return errorResult(error);
    }
  });

  server.registerTool("halo_update_ticket", {
    title: "Update Ticket",
    description:
      "Update an existing HaloPSA ticket. Provide the ticket ID and any fields to update.",
    inputSchema: {
      id: z.number().describe("Ticket ID to update"),
      summary: z.string().optional().describe("Updated summary"),
      details: z.string().optional().describe("Updated description"),
      client_id: z.number().optional().describe("Updated client ID"),
      site_id: z.number().optional().describe("Updated site ID"),
      user_id: z.number().optional().describe("Updated user/contact ID"),
      agent_id: z.number().optional().describe("Reassign to agent ID"),
      team_id: z.number().optional().describe("Reassign to team ID"),
      status_id: z.number().optional().describe("Updated status ID"),
      priority_id: z.number().optional().describe("Updated priority ID"),
      category_1: z.string().optional().describe("Updated category level 1"),
      category_2: z.string().optional().describe("Updated category level 2"),
      category_3: z.string().optional().describe("Updated category level 3"),
      impact: z.number().optional().describe("Updated impact level"),
      urgency: z.number().optional().describe("Updated urgency level"),
      deadlinedate: z
        .string()
        .optional()
        .describe("Updated deadline date (ISO 8601)"),
    },
  }, async (args) => {
    try {
      // Filter undefined values to avoid sending nulls to API
      const payload: Record<string, unknown> = { id: args.id };
      for (const [key, value] of Object.entries(args)) {
        if (value !== undefined) payload[key] = value;
      }
      const result = await client.post<HaloTicket>("/Tickets", payload);
      return {
        content: [
          {
            type: "text",
            text: `Ticket ${args.id} updated successfully:\n${JSON.stringify(result, null, 2)}`,
          },
        ],
      };
    } catch (error) {
      return errorResult(error);
    }
  });

  server.registerTool("halo_list_assigned_tickets", {
    title: "List Assigned Tickets",
    description:
      "List all tickets assigned to a specific agent. Useful for finding a user's workload. Returns open tickets by default.",
    inputSchema: {
      agent_id: z.number().describe("Agent ID to find assigned tickets for"),
      open_only: z
        .boolean()
        .optional()
        .describe("Only return open tickets (default true)"),
      ...paginationSchema,
    },
  }, async (args) => {
    try {
      const result = await client.getList<HaloTicket>(
        "/Tickets",
        {
          agent_id: args.agent_id,
          open_only: args.open_only ?? true,
          page_size: args.page_size ?? 50,
          page_no: args.page_no ?? 1,
          order: args.order ?? "dateoccurred",
          orderdesc: args.orderdesc ?? true,
          search: args.search,
        }
      );
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                record_count: result.record_count,
                assigned_to_agent: args.agent_id,
                tickets: result.records.map((t) => ({
                  id: t.id,
                  summary: t.summary,
                  client_name: t.client_name,
                  status: t.status,
                  priority: t.priority,
                  dateoccurred: t.dateoccurred,
                })),
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      return errorResult(error);
    }
  });

  server.registerTool("halo_get_my_tickets", {
    title: "Get My Tickets",
    description:
      "Get all tickets assigned to the currently authenticated agent. Automatically identifies the logged-in user via the HaloPSA API and returns their assigned tickets. No agent ID required.",
    inputSchema: {
      open_only: z
        .boolean()
        .optional()
        .describe("Only return open tickets (default true)"),
      ...paginationSchema,
    },
  }, async (args) => {
    try {
      const me = await client.get<HaloAgent>("/Agent/me");
      const result = await client.getList<HaloTicket>(
        "/Tickets",
        {
          agent_id: me.id,
          open_only: args.open_only ?? true,
          page_size: args.page_size ?? 50,
          page_no: args.page_no ?? 1,
          order: args.order ?? "dateoccurred",
          orderdesc: args.orderdesc ?? true,
          search: args.search,
        }
      );
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                agent: {
                  id: me.id,
                  name: me.name,
                  email: me.email,
                },
                record_count: result.record_count,
                tickets: result.records.map((t) => ({
                  id: t.id,
                  summary: t.summary,
                  client_name: t.client_name,
                  status: t.status,
                  priority: t.priority,
                  dateoccurred: t.dateoccurred,
                  deadlinedate: t.deadlinedate,
                  team: t.team,
                })),
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      return errorResult(error);
    }
  });

  server.registerTool("halo_list_created_tickets", {
    title: "List Created Tickets",
    description:
      "List all tickets created by (reported by) a specific agent or user. Useful for tracking tickets that were created through the MCP server or by a particular user.",
    inputSchema: {
      reportedby: z
        .number()
        .describe("Agent/user ID who created (reported) the tickets"),
      open_only: z
        .boolean()
        .optional()
        .describe("Only return open tickets (default false to show all)"),
      ...paginationSchema,
    },
  }, async (args) => {
    try {
      const result = await client.getList<HaloTicket>(
        "/Tickets",
        {
          reportedby: args.reportedby,
          open_only: args.open_only ?? false,
          page_size: args.page_size ?? 50,
          page_no: args.page_no ?? 1,
          order: args.order ?? "dateoccurred",
          orderdesc: args.orderdesc ?? true,
          search: args.search,
        }
      );
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                record_count: result.record_count,
                reported_by: args.reportedby,
                tickets: result.records.map((t) => ({
                  id: t.id,
                  summary: t.summary,
                  client_name: t.client_name,
                  agent_name: t.agent_name,
                  status: t.status,
                  priority: t.priority,
                  dateoccurred: t.dateoccurred,
                })),
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      return errorResult(error);
    }
  });
}
