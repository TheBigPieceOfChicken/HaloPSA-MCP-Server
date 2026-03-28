import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HaloApiClient } from "../client/halo-api-client.js";
import type {
  HaloTicket,
  HaloAction,
  HaloListResponse,
} from "../client/types.js";
import { errorResult } from "../utils/errors.js";

export function registerWorkflowTools(
  server: McpServer,
  client: HaloApiClient
): void {

  // --- Close Ticket ---
  server.registerTool("halo_close_ticket", {
    title: "Close Ticket",
    description:
      "Close a HaloPSA ticket in one step: sets status to Closed, adds a closing note, and optionally logs final time.",
    inputSchema: {
      ticket_id: z.number().describe("Ticket ID to close"),
      note: z.string().optional().describe("Closing note (default: 'Ticket closed')"),
      outcome: z.string().optional().describe("Outcome type for the closing action (e.g. 'Note')"),
      timetaken: z.number().optional().describe("Final time to log in minutes (optional)"),
      status_id: z.number().optional().describe("Status ID to set (default: 9 = Closed)"),
      datetime: z.string().optional().describe("When the work was performed (ISO 8601). Use for backdating. Defaults to now."),
    },
  }, async (args) => {
    try {
      // Update ticket status
      await client.post<HaloTicket>("/Tickets", {
        id: args.ticket_id,
        status_id: args.status_id ?? 9,
      });
      // Add closing action with optional time
      const actionBody: Record<string, unknown> = {
        ticket_id: args.ticket_id,
        note: args.note ?? "Ticket closed",
        outcome: args.outcome ?? "Note",
        hiddenfromuser: false,
      };
      if (args.timetaken) {
        actionBody.timetaken = args.timetaken;
      }
      if (args.datetime) {
        actionBody.datetime = args.datetime;
        actionBody.actioncompletiondate = args.datetime;
      }
      await client.post<HaloAction>("/Actions", actionBody);
      return {
        content: [
          {
            type: "text",
            text: `Ticket ${args.ticket_id} closed successfully.${args.timetaken ? ` Logged ${args.timetaken} minutes.` : ""}`,
          },
        ],
      };
    } catch (error) {
      return errorResult(error);
    }
  });

  // --- Get Client Summary ---
  server.registerTool("halo_get_client_summary", {
    title: "Get Client Summary",
    description:
      "Get a full summary of a HaloPSA client in one call: client details, sites, open tickets, contracts, and recent invoices.",
    inputSchema: {
      client_id: z.number().describe("Client ID to summarize"),
    },
  }, async (args) => {
    try {
      const [clientData, sites, tickets, contracts, invoices] = await Promise.all([
        client.get<Record<string, unknown>>(`/Client/${args.client_id}`, { includedetails: true }),
        client.getList<Record<string, unknown>>("/Site", { client_id: args.client_id, page_size: 50 }),
        client.getList<HaloTicket>("/Tickets", { client_id: args.client_id, open_only: true, page_size: 50 }),
        client.getList<Record<string, unknown>>("/ClientContract", { client_id: args.client_id, page_size: 50 }),
        client.getList<Record<string, unknown>>("/Invoice", { client_id: args.client_id, page_size: 10, orderdesc: true }),
      ]);
      const summary = {
        client: {
          id: clientData.id,
          name: clientData.name,
          website: clientData.website,
          main_contact: clientData.main_contact_name,
          main_email: clientData.main_contact_email,
          main_phone: clientData.main_phonenumber,
        },
        sites: {
          count: sites.record_count,
          list: sites.records.map((s) => ({ id: s.id, name: s.name })),
        },
        open_tickets: {
          count: tickets.record_count,
          list: tickets.records.map((t) => ({
            id: t.id,
            summary: t.summary,
            status_id: t.status_id,
            dateoccurred: (t as Record<string, unknown>).dateoccurred,
          })),
        },
        contracts: {
          count: contracts.record_count,
          list: contracts.records.map((c) => ({ id: c.id, ref: c.ref })),
        },
        recent_invoices: {
          count: invoices.record_count,
          list: invoices.records.map((i) => ({
            id: i.id,
            total: i.total,
            date: i.invoice_date ?? i.date,
          })),
        },
      };
      return {
        content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
      };
    } catch (error) {
      return errorResult(error);
    }
  });

  // --- Get Ticket Timeline ---
  server.registerTool("halo_get_ticket_timeline", {
    title: "Get Ticket Timeline",
    description:
      "Get a complete ticket timeline: ticket details, all actions (notes/emails), time entries, and billable summary — all in one call.",
    inputSchema: {
      ticket_id: z.number().describe("Ticket ID to get timeline for"),
      exclude_system: z.boolean().optional().describe("Exclude system-generated actions (default true)"),
    },
  }, async (args) => {
    try {
      const [ticket, actions, timeEntries] = await Promise.all([
        client.get<HaloTicket>(`/Tickets/${args.ticket_id}`),
        client.getList<HaloAction>("/Actions", {
          ticket_id: args.ticket_id,
          page_size: 200,
          excludesys: args.exclude_system ?? true,
        }),
        client.getList<HaloAction>("/Actions", {
          ticket_id: args.ticket_id,
          page_size: 200,
          showall: true,
        }),
      ]);
      // Filter time entries (actions with timetaken > 0)
      const timeOnly = timeEntries.records.filter(
        (a) => ((a as Record<string, unknown>).timetaken as number) > 0
      );
      const totalMinutes = timeOnly.reduce(
        (sum, a) => sum + (((a as Record<string, unknown>).timetaken as number) ?? 0),
        0
      );
      const summary = {
        ticket: {
          id: ticket.id,
          summary: ticket.summary,
          status_id: ticket.status_id,
          client_name: ticket.client_name,
          agent_id: (ticket as Record<string, unknown>).agent_id,
          dateoccurred: (ticket as Record<string, unknown>).dateoccurred,
        },
        actions: actions.records.map((a) => ({
          id: a.id,
          who: (a as Record<string, unknown>).who,
          outcome: a.outcome,
          note: a.note?.substring(0, 200),
          datetime: (a as Record<string, unknown>).datetime,
          timetaken: (a as Record<string, unknown>).timetaken,
          hiddenfromuser: a.hiddenfromuser,
        })),
        time_summary: {
          entries: timeOnly.length,
          total_minutes: totalMinutes,
          total_hours: Math.round((totalMinutes / 60) * 100) / 100,
        },
      };
      return {
        content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
      };
    } catch (error) {
      return errorResult(error);
    }
  });

  // --- Weekly Timesheet ---
  server.registerTool("halo_weekly_timesheet", {
    title: "Weekly Timesheet",
    description:
      "Get all time entries for an agent for the current or specified week. Returns entries grouped by day with totals.",
    inputSchema: {
      agent_id: z.number().optional().describe("Agent ID (defaults to authenticated user's entries)"),
      week_offset: z.number().optional().describe("0 = current week, -1 = last week, etc. (default 0)"),
    },
  }, async (args) => {
    try {
      const offset = args.week_offset ?? 0;
      const now = new Date();
      const dayOfWeek = now.getDay();
      const monday = new Date(now);
      monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1) + (offset * 7));
      monday.setHours(0, 0, 0, 0);
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      sunday.setHours(23, 59, 59, 999);

      const startdate = monday.toISOString().split("T")[0];
      const enddate = sunday.toISOString().split("T")[0];

      const params: Record<string, unknown> = {
        page_size: 200,
        startdate,
        enddate,
      };
      if (args.agent_id) params.agent_id = args.agent_id;

      // Fetch actions and filter for time entries
      const result = await client.getList<HaloAction>("/Actions", params);
      const timeEntries = result.records.filter(
        (a) => ((a as Record<string, unknown>).timetaken as number) > 0
      );

      // Group by day
      const byDay: Record<string, { entries: unknown[]; total_minutes: number }> = {};
      for (const entry of timeEntries) {
        const raw = entry as Record<string, unknown>;
        const dt = String(raw.datetime ?? "").split("T")[0] || "unknown";
        if (!byDay[dt]) byDay[dt] = { entries: [], total_minutes: 0 };
        const minutes = (raw.timetaken as number) ?? 0;
        byDay[dt].entries.push({
          id: raw.id,
          ticket_id: raw.ticket_id,
          note: (raw.note as string)?.substring(0, 100),
          timetaken: minutes,
          outcome: raw.outcome,
        });
        byDay[dt].total_minutes += minutes;
      }

      const totalMinutes = timeEntries.reduce(
        (sum, a) => sum + (((a as Record<string, unknown>).timetaken as number) ?? 0),
        0
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                week: `${startdate} to ${enddate}`,
                agent_id: args.agent_id ?? "authenticated user",
                total_entries: timeEntries.length,
                total_minutes: totalMinutes,
                total_hours: Math.round((totalMinutes / 60) * 100) / 100,
                by_day: byDay,
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

  // --- Unbilled Time ---
  server.registerTool("halo_unbilled_time", {
    title: "Unbilled Time",
    description:
      "Find all billable time entries that have not yet been invoiced, grouped by client. Useful for billing prep.",
    inputSchema: {
      client_id: z.number().optional().describe("Filter to a specific client (optional — omit for all clients)"),
      startdate: z.string().optional().describe("Start date filter (ISO 8601, e.g. 2026-01-01)"),
      enddate: z.string().optional().describe("End date filter (ISO 8601)"),
    },
  }, async (args) => {
    try {
      const params: Record<string, unknown> = {
        page_size: 500,
        excludeinvoiced: true,
      };
      if (args.client_id) params.client_id = args.client_id;
      if (args.startdate) params.startdate = args.startdate;
      if (args.enddate) params.enddate = args.enddate;

      const result = await client.getList<HaloAction>("/Actions", params);
      const billableEntries = result.records.filter(
        (a) => {
          const raw = a as Record<string, unknown>;
          return ((raw.timetaken as number) > 0) && (raw.actisbillable === true);
        }
      );

      // Group by client
      const byClient: Record<string, { tickets: Set<number>; total_minutes: number; entries: number }> = {};
      for (const entry of billableEntries) {
        const raw = entry as Record<string, unknown>;
        const clientName = String(raw.client_name ?? raw.who ?? "Unknown");
        if (!byClient[clientName]) byClient[clientName] = { tickets: new Set(), total_minutes: 0, entries: 0 };
        byClient[clientName].total_minutes += (raw.timetaken as number) ?? 0;
        byClient[clientName].entries += 1;
        if (raw.ticket_id) byClient[clientName].tickets.add(raw.ticket_id as number);
      }

      const clientSummaries = Object.entries(byClient).map(([name, data]) => ({
        client: name,
        entries: data.entries,
        tickets: data.tickets.size,
        total_minutes: data.total_minutes,
        total_hours: Math.round((data.total_minutes / 60) * 100) / 100,
      }));

      const totalMinutes = billableEntries.reduce(
        (sum, a) => sum + (((a as Record<string, unknown>).timetaken as number) ?? 0),
        0
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                total_unbilled_entries: billableEntries.length,
                total_unbilled_minutes: totalMinutes,
                total_unbilled_hours: Math.round((totalMinutes / 60) * 100) / 100,
                by_client: clientSummaries.sort((a, b) => b.total_minutes - a.total_minutes),
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

  // --- Reassign Ticket ---
  server.registerTool("halo_reassign_ticket", {
    title: "Reassign Ticket",
    description:
      "Reassign a ticket to a different agent and/or team with a handoff note in one step.",
    inputSchema: {
      ticket_id: z.number().describe("Ticket ID to reassign"),
      agent_id: z.number().optional().describe("New agent ID"),
      team_id: z.number().optional().describe("New team ID"),
      note: z.string().describe("Handoff note explaining the reassignment"),
      outcome: z.string().optional().describe("Outcome type (default: 'Note')"),
    },
  }, async (args) => {
    try {
      const updatePayload: Record<string, unknown> = { id: args.ticket_id };
      if (args.agent_id !== undefined) updatePayload.agent_id = args.agent_id;
      if (args.team_id !== undefined) updatePayload.team_id = args.team_id;
      await client.post<HaloTicket>("/Tickets", updatePayload);
      await client.post<HaloAction>("/Actions", {
        ticket_id: args.ticket_id,
        note: args.note,
        outcome: args.outcome ?? "Note",
        hiddenfromuser: true,
      });
      return {
        content: [
          {
            type: "text",
            text: `Ticket ${args.ticket_id} reassigned.${args.agent_id ? ` Agent: ${args.agent_id}.` : ""}${args.team_id ? ` Team: ${args.team_id}.` : ""} Handoff note added.`,
          },
        ],
      };
    } catch (error) {
      return errorResult(error);
    }
  });

  // --- Escalate Ticket ---
  server.registerTool("halo_escalate_ticket", {
    title: "Escalate Ticket",
    description:
      "Escalate a ticket: bump priority, optionally change status, and add an escalation note — all in one step.",
    inputSchema: {
      ticket_id: z.number().describe("Ticket ID to escalate"),
      priority_id: z.number().describe("New priority ID (e.g. 1=Urgent)"),
      note: z.string().describe("Escalation reason"),
      status_id: z.number().optional().describe("New status ID (optional)"),
      outcome: z.string().optional().describe("Outcome type (default: 'Note')"),
    },
  }, async (args) => {
    try {
      const updatePayload: Record<string, unknown> = {
        id: args.ticket_id,
        priority_id: args.priority_id,
      };
      if (args.status_id !== undefined) updatePayload.status_id = args.status_id;
      await client.post<HaloTicket>("/Tickets", updatePayload);
      await client.post<HaloAction>("/Actions", {
        ticket_id: args.ticket_id,
        note: `[ESCALATION] ${args.note}`,
        outcome: args.outcome ?? "Note",
        hiddenfromuser: true,
      });
      return {
        content: [
          {
            type: "text",
            text: `Ticket ${args.ticket_id} escalated to priority ${args.priority_id}. Escalation note added.`,
          },
        ],
      };
    } catch (error) {
      return errorResult(error);
    }
  });
}
