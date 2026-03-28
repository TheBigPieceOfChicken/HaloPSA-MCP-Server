import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HaloApiClient } from "../client/halo-api-client.js";
import type { HaloListResponse } from "../client/types.js";
import { paginationSchema } from "../utils/pagination.js";
import { errorResult } from "../utils/errors.js";

/**
 * Time entries in HaloPSA are Actions with timetaken > 0.
 * There is no standalone /Timesheet endpoint.
 * These tools wrap /Actions to provide a clean time-tracking interface.
 */

interface HaloAction {
  id: number;
  ticket_id: number;
  who: string;
  who_agentid: number;
  note: string;
  timetaken: number;
  nonbilltime: number;
  traveltime: number;
  actisbillable: boolean;
  datetime: string;
  outcome: string;
  [key: string]: unknown;
}

export function registerTimesheetTools(
  server: McpServer,
  client: HaloApiClient
): void {
  // 3a. List time entries (Actions with timetaken > 0)
  server.registerTool("halo_list_time_entries", {
    title: "List Time Entries",
    description:
      "List time entries logged against HaloPSA tickets. Time entries are Actions with time recorded. Provide at least one filter (ticket_id or agent_id) — calling with no filters returns empty results.",
    inputSchema: {
      ticket_id: z.number().optional().describe("Filter by ticket ID"),
      agent_id: z.number().optional().describe("Filter by agent ID (who_agentid)"),
      startdate: z
        .string()
        .optional()
        .describe("Filter entries from this date (ISO 8601, e.g. 2026-01-01)"),
      enddate: z
        .string()
        .optional()
        .describe("Filter entries up to this date (ISO 8601, e.g. 2026-12-31)"),
      ...paginationSchema,
    },
  }, async (args) => {
    try {
      const result = await client.getList<HaloAction>(
        "/Actions",
        {
          ticket_id: args.ticket_id,
          agent_id: args.agent_id,
          startdate: args.startdate,
          enddate: args.enddate,
          excludesys: true,
          page_size: args.page_size ?? 50,
          page_no: args.page_no ?? 1,
          order: args.order,
          orderdesc: args.orderdesc,
          search: args.search,
        }
      );

      // Filter to only actions with time logged
      const timeEntries = result.records.filter(
        (a) => (a.timetaken ?? 0) > 0 || (a.nonbilltime ?? 0) > 0
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                record_count: timeEntries.length,
                entries: timeEntries.map((a) => ({
                  id: a.id,
                  ticket_id: a.ticket_id,
                  agent: a.who,
                  agent_id: a.who_agentid,
                  timetaken: a.timetaken,
                  nonbilltime: a.nonbilltime,
                  traveltime: a.traveltime,
                  billable: a.actisbillable,
                  note: a.note,
                  datetime: a.datetime,
                  outcome: a.outcome,
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

  // 3b. Create time entry (POST /Actions with timetaken)
  server.registerTool("halo_create_time_entry", {
    title: "Create Time Entry",
    description:
      "Log time against a HaloPSA ticket. Creates an Action with time recorded. Time is in minutes.",
    inputSchema: {
      ticket_id: z.number().describe("Ticket ID to log time against"),
      timetaken: z.number().describe("Billable time in minutes"),
      note: z.string().describe("Description of work performed"),
      nonbilltime: z
        .number()
        .optional()
        .describe("Non-billable time in minutes (default 0)"),
      traveltime: z
        .number()
        .optional()
        .describe("Travel time in minutes (default 0)"),
      agent_id: z
        .number()
        .optional()
        .describe("Agent ID performing the work (defaults to authenticated user)"),
      actisbillable: z
        .boolean()
        .optional()
        .describe("Whether this entry is billable (default true)"),
      outcome: z
        .string()
        .optional()
        .describe("Outcome type for the action (e.g. 'Remote Support', 'Note'). Required by some HaloPSA configurations."),
      outcome_id: z
        .number()
        .optional()
        .describe("Outcome ID (alternative to outcome name)"),
      datetime: z
        .string()
        .optional()
        .describe("When the work was performed (ISO 8601). Use for backdating time entries. Defaults to now."),
    },
  }, async (args) => {
    try {
      const actionBody: Record<string, unknown> = {
        ticket_id: args.ticket_id,
        timetaken: args.timetaken,
        note: args.note,
        nonbilltime: args.nonbilltime ?? 0,
        traveltime: args.traveltime ?? 0,
        who_agentid: args.agent_id,
        actisbillable: args.actisbillable ?? true,
        outcome: args.outcome,
        outcome_id: args.outcome_id,
      };
      if (args.datetime) {
        actionBody.datetime = args.datetime;
        actionBody.actioncompletiondate = args.datetime;
      }
      const result = await client.post<HaloAction>("/Actions", actionBody);
      return {
        content: [
          {
            type: "text",
            text: `Time entry created on ticket ${args.ticket_id}:\n${JSON.stringify(
              {
                id: (result as Record<string, unknown>).id,
                ticket_id: args.ticket_id,
                timetaken: args.timetaken,
                nonbilltime: args.nonbilltime ?? 0,
                note: args.note,
              },
              null,
              2
            )}`,
          },
        ],
      };
    } catch (error) {
      return errorResult(error);
    }
  });

  // 3c. Update time entry (POST /Actions with id)
  server.registerTool("halo_update_time_entry", {
    title: "Update Time Entry",
    description:
      "Update an existing time entry (Action) on a HaloPSA ticket. Provide the action ID and ticket_id plus any fields to update.",
    inputSchema: {
      id: z.number().describe("Action ID of the time entry to update"),
      ticket_id: z.number().describe("Ticket ID the action belongs to"),
      timetaken: z.number().optional().describe("Updated billable time in minutes"),
      nonbilltime: z.number().optional().describe("Updated non-billable time in minutes"),
      traveltime: z.number().optional().describe("Updated travel time in minutes"),
      note: z.string().optional().describe("Updated note"),
      actisbillable: z.boolean().optional().describe("Updated billable status"),
    },
  }, async (args) => {
    try {
      const result = await client.post<HaloAction>("/Actions", {
        id: args.id,
        ticket_id: args.ticket_id,
        timetaken: args.timetaken,
        nonbilltime: args.nonbilltime,
        traveltime: args.traveltime,
        note: args.note,
        actisbillable: args.actisbillable,
      });
      return {
        content: [
          {
            type: "text",
            text: `Time entry ${args.id} updated successfully.`,
          },
        ],
      };
    } catch (error) {
      return errorResult(error);
    }
  });

  // 3d. Delete time entry (DELETE /Actions/{id})
  server.registerTool("halo_delete_time_entry", {
    title: "Delete Time Entry",
    description:
      "Delete a time entry (Action) from a HaloPSA ticket. This is irreversible. Requires confirm=true.",
    inputSchema: {
      action_id: z.number().describe("Action ID of the time entry to delete"),
      ticket_id: z.number().describe("Ticket ID the action belongs to"),
      confirm: z
        .boolean()
        .describe("Must be true to confirm deletion"),
    },
  }, async (args) => {
    if (args.confirm !== true) {
      return {
        content: [
          {
            type: "text",
            text: "You must set confirm: true to delete a time entry. This action is irreversible.",
          },
        ],
      };
    }
    try {
      await client.delete(`/Actions/${args.action_id}?ticket_id=${args.ticket_id}`);
      return {
        content: [
          {
            type: "text",
            text: `Time entry (action ${args.action_id}) deleted successfully.`,
          },
        ],
      };
    } catch (error) {
      return errorResult(error);
    }
  });

  // 3e. Get billable summary (computed from Actions)
  server.registerTool("halo_get_billable_summary", {
    title: "Get Billable Summary",
    description:
      "Compute a billable time summary for a ticket, client, or agent. Fetches all matching time entries and calculates totals. Requires at least one filter.",
    inputSchema: {
      ticket_id: z.number().optional().describe("Ticket ID to summarize"),
      agent_id: z.number().optional().describe("Agent ID to summarize"),
      startdate: z.string().optional().describe("Start date filter (ISO 8601)"),
      enddate: z.string().optional().describe("End date filter (ISO 8601)"),
    },
  }, async (args) => {
    try {
      if (!args.ticket_id && !args.agent_id) {
        return {
          content: [
            {
              type: "text",
              text: "Error: At least one of ticket_id or agent_id is required.",
            },
          ],
          isError: true,
        };
      }

      // Fetch all matching actions, paginating through
      const allEntries: HaloAction[] = [];
      let pageNo = 1;
      const pageSize = 100;
      let hasMore = true;

      while (hasMore) {
        const result = await client.getList<HaloAction>(
          "/Actions",
          {
            ticket_id: args.ticket_id,
            agent_id: args.agent_id,
            startdate: args.startdate,
            enddate: args.enddate,
            excludesys: true,
            page_size: pageSize,
            page_no: pageNo,
          }
        );

        // Only keep actions with time logged
        const withTime = result.records.filter(
          (a) => (a.timetaken ?? 0) > 0 || (a.nonbilltime ?? 0) > 0
        );
        allEntries.push(...withTime);
        hasMore = result.records.length === pageSize;
        pageNo++;
      }

      let billableMinutes = 0;
      let nonBillableMinutes = 0;
      let travelMinutes = 0;

      for (const entry of allEntries) {
        billableMinutes += entry.timetaken ?? 0;
        nonBillableMinutes += entry.nonbilltime ?? 0;
        travelMinutes += entry.traveltime ?? 0;
      }

      const totalMinutes = billableMinutes + nonBillableMinutes;
      const toHours = (m: number) => Math.round((m / 60) * 100) / 100;

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                entries_count: allEntries.length,
                total_minutes: totalMinutes,
                total_hours: toHours(totalMinutes),
                billable_minutes: billableMinutes,
                billable_hours: toHours(billableMinutes),
                non_billable_minutes: nonBillableMinutes,
                non_billable_hours: toHours(nonBillableMinutes),
                travel_minutes: travelMinutes,
                travel_hours: toHours(travelMinutes),
                filters: {
                  ticket_id: args.ticket_id,
                  agent_id: args.agent_id,
                  startdate: args.startdate,
                  enddate: args.enddate,
                },
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
