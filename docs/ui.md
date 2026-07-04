# Business UI Philosophy

## Purpose

This document defines the default UI philosophy for all business applications generated for this project.

The goal is **not** to produce award-winning interfaces.

The goal is to build interfaces that expose business workflows, data relationships, and operational state as clearly as possible.

Unless a project explicitly requires a consumer-focused experience, all applications should follow these conventions.

---

# Design Principles

## Data First

The interface exists to expose data, not decorate it.

Users should be able to answer operational questions with as few interactions as possible.

Information density is preferred over unnecessary whitespace.

---

## Consistency Over Creativity

Every entity should behave similarly.

Users should not have to learn different interaction patterns throughout the application.

Predictability is a feature.

---

## Desktop First

These applications are primarily operational tools.

Optimize for desktop workflows before considering mobile.

Keyboard and mouse efficiency should take priority over touch interactions.

---

## Calm Interfaces

Use neutral colors.

Avoid unnecessary animations.

Visual hierarchy should come from typography and spacing rather than decoration.

The interface should disappear behind the workflow.

---

## Workflow First

Pages should mirror how people actually work.

Avoid designing isolated CRUD pages.

Instead, surface the information required to complete a task.

Example:

Estimating should expose:

- historical projects
- historical pricing
- supplier history
- documents

rather than forcing navigation across multiple screens.

---

# Overall Layout

Applications should use a common shell.

```
+------------------------------------------------------------+
| Top Bar                                                    |
+-------------+----------------------------------------------+
|             |                                              |
| Sidebar     | Main Content                                 |
|             |                                              |
|             |                                              |
|             |                                              |
|             |                                              |
+-------------+-----------------------------+----------------+
| Optional Inspector / Detail Panel         |                |
+-------------------------------------------+----------------+
```

---

# Navigation

Sidebar navigation should be entity-driven.

Example:

- Dashboard
- Projects
- Documents
- Materials
- Suppliers
- Estimates
- Reports
- Settings

Avoid deeply nested navigation.

Maximum two levels whenever possible.

---

# Resource Pattern

Every major entity should follow the same structure.

Example:

Project

- List
- Detail
- Create
- Edit
- Archive

Supplier

- List
- Detail
- Related Projects
- Documents

Material

- List
- Historical Prices
- Usage History

This consistency should apply across every application.

---

# Lists

Lists are the primary way users explore data.

Default capabilities:

- sorting
- filtering
- pagination
- search
- saved column widths
- bulk actions where appropriate

Prefer tables over cards for operational software.

---

# Detail Pages

Every entity detail page should follow the same structure.

Header

- title
- metadata
- primary actions

Body

- overview
- related entities
- documents
- activity timeline

Users should rarely need to navigate away to understand context.

---

# Search

Every application should support global search.

Search should prioritize:

- projects
- documents
- materials
- suppliers

Search should be accessible via keyboard shortcut.

---

# Forms

Forms should be simple and predictable.

Guidelines:

- labels above fields
- inline validation
- clear required fields
- logical grouping
- destructive actions separated

Avoid wizard-style flows unless absolutely necessary.

---

# Documents

Whenever documents are uploaded:

Always preserve the original.

Display:

- preview
- extracted metadata
- extracted structured data
- extraction confidence (when applicable)

Users should always be able to compare extracted information against the source document.

---

# Activity

Every important entity should have an activity timeline.

Examples:

- created
- edited
- document uploaded
- estimate generated
- extraction completed

Operational software benefits from transparent history.

---

# Empty States

Never display an empty table without guidance.

Instead explain:

- why no data exists
- how to create data
- the next logical action

---

# Visual Style

Default inspiration:

- Linear
- GitHub
- Stripe Dashboard
- Supabase
- Retool
- Vercel Dashboard

Avoid:

- excessive gradients
- glassmorphism
- decorative animations
- oversized cards
- unnecessary illustrations

This is business software, not marketing.

---

# Default Components

Claude should favor these reusable interface patterns.

## Resource Table

Features:

- sorting
- filtering
- search
- pagination
- bulk actions
- row selection

---

## Detail View

Sections:

- Overview
- Related Resources
- Documents
- Activity

---

## Inspector Panel

Optional right-side panel displaying contextual information without requiring page navigation.

Useful for:

- material details
- supplier details
- document previews

---

## Dashboard

Dashboards should summarize operational state rather than display vanity metrics.

Useful widgets:

- recent activity
- recently modified projects
- outstanding tasks
- recent uploads
- quick actions

Avoid charts unless they directly support decision-making.

---

# Interaction Philosophy

Prefer:

- fewer pages
- fewer clicks
- keyboard shortcuts
- contextual actions
- inline editing where appropriate

Avoid:

- unnecessary modal dialogs
- excessive confirmation prompts
- hidden navigation
- deep menu trees

---

# AI Features

AI should augment workflows, not replace them.

Examples:

Good:

- extract invoice data
- normalize product names
- summarize project history
- suggest historical pricing

Bad:

- generate arbitrary dashboards
- invent missing business data
- obscure where information originated

Users must always understand where data came from.

---

# Design Hierarchy

When making UI decisions, prioritize in this order:

1. Workflow clarity
2. Data visibility
3. Consistency
4. Speed
5. Aesthetics

Never sacrifice operational efficiency for visual novelty.

---

# Default Assumption

Unless explicitly instructed otherwise, Claude should assume every application is an internal operational tool used daily by professionals.

The interface should feel mature, calm, information-dense, and highly functional.

The goal is to build software that becomes invisible to its users because it aligns naturally with the way they already work.