---
slug: payroll-settings
title: Payroll, CPF settings and the control plane
summary: CPF and pay settings are finance/HQ only. Every change is logged with who, when and from where.
category: payroll
primary_path: /reports
related_paths: [/permissions, /help/payroll-lock]
intent_tags: [payroll, cpf, pay settings, eor, employer of record, finance, control plane, who changed payroll, payroll audit, singapore payroll]
audience: [finance, hq_admin]
sort_order: 70
---

# Payroll, CPF settings and the control plane

Payroll is **financial processing**. In FranHRM only two roles touch it:

- **Finance** and **HQ Admin** can manage **CPF & pay settings** (`payroll:settings`) and run **payroll / EOR processing** (`payroll:process`).
- **Store managers** approve shifts, timesheets and leave — but never CPF or pay settings.

These are ordinary rows in the editable permission matrix (**Permissions**), so an owner can widen or narrow them, but the shipped default is finance + HQ only.

## CPF & pay settings

The settings hold your Singapore CPF/EOR configuration — ordinary/additional wage ceilings, the age-banded contribution rates your EOR uses, pay cycle, and the EOR provider reference. Update them by merging a partial change; only the keys you send are touched.

## The control plane

**Every** change to payroll settings is logged — who made it, when, from where (web, API or Claude), and exactly which keys changed, with the before and after values. Nothing about pay can be altered without a trace. The same rule applies whether the change comes through the web app, the REST API, or Claude via the MCP tools, so there is one accountable record.

Ask Claude "who changed the CPF settings and when?" and it reads that log through the `payroll_settings_history` tool — subject to the same finance/HQ permission.
