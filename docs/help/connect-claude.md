---
slug: connect-claude
title: Using FranHRM in Claude
summary: Connect once with your employee code and PIN; Claude then answers with your own permissions.
category: claude
primary_path: /oauth/connect
related_paths: [/connect-claude]
intent_tags: [claude, mcp, connector, ai, assistant, connect claude, oauth, ask claude, chatgpt, integration]
sort_order: 80
---

# Using FranHRM in Claude

Once connected, you can ask Claude things like:

> "When am I working next week?"
> "How many hours did I work in July?"
> "How much annual leave do I have left?"
> "Apply for annual leave on 14 August" *(creates a pending request — your manager still approves)*

Managers can additionally ask:

> "Show me lateness flags at Orchard this month"
> "Who is over 44 hours this week?"
> "Publish the draft roster for next week"

## Connecting

1. In Claude, go to **Settings → Connectors**.
2. Add a custom connector with the FranHRM URL (an HQ admin has it — it ends in `/mcp`).
3. Under **Advanced settings**, paste the **OAuth Client ID and Secret** from your HQ admin. These are the same for everyone in the company.
4. Click **Connect**.
5. You are sent to FranHRM to **sign in with your employee code and PIN**, then shown exactly which account and how many tools you are about to grant.
6. Approve.

If your organisation has already added the connector, you only need steps 4–6.

## What Claude can and cannot do

Claude acts **as you**. It gets exactly the permissions your FranHRM role has — no more:

| Your role | What Claude can do |
|---|---|
| Staff | Read your own hours, shifts and leave; file your own leave requests |
| Supervisor | The above for your store, plus draft roster edits and attendance corrections |
| Store Manager | Plus publish rosters and approve leave |
| Area Manager / HQ Admin | Everything, including staff records and pay-rate-based cost reporting |

Ask Claude *"what can you do in FranHRM?"* and it will tell you precisely — it calls a `capabilities` tool rather than guessing.

## Permissions stay current

Your permissions are re-checked **on every request**, not frozen when you connected. If your role changes, or you leave the company, Claude's access changes on the next message. There is no stale-token window.

## Privacy

- Staff can only ever read their own records. Asking about a colleague returns a permission error, not their data.
- Pay rates and manpower cost are area-manager-and-above only.
- Every change Claude makes is written to the audit trail **attributed to you**, not to "an agent".

## Disconnecting

Ask an HQ admin to disconnect you (**Manage → Connect Claude → Disconnect**), or remove the connector in Claude. Either is enough.
