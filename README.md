# Switchboard

**A unified pipeline to bypass daily IDE quotas, survive rate limits, and double the value of every AI subscription you own.**

Switchboard is a VS Code extension that coordinates CLI agents (Copilot CLI, Claude Code, Gemini CLI, Codex), IDE chat agents (Windsurf, Antigravity), and local LLMs into a fault-tolerant dev pipeline. It uses a **CLI-BAN Routing Board** as the central pipeline control surface — create plans, drag-and-drop them to agents, batch entire sprints into single prompts, and auto-route work by complexity.

With Windsurf enforcing strict daily quotas (as few as 7 Opus messages/day), Copilot actively throttling heavy users, and Gemini CLI applying usage caps, no single subscription is reliable enough to code through a full day. Switchboard turns your scattered subscriptions into one resilient pipeline — so when one provider throttles, your work keeps moving.

No authentication hacks, no API keys. Just the official VS Code API (`terminal.sendText`) and a local SQLite database running in your repo.

![Switchboard](https://raw.githubusercontent.com/TentacleOpera/switchboard/main/docs/switchboardui.png)


## Example Workflow

Here's what a real session looks like — combining Windsurf, Copilot CLI, and Gemini CLI:

1. Create 11 plans in the CLI-BAN **New** column using the **Create Plan** button
2. Ask Windsurf Opus to "run the improve plan workflow on all plans in the New column"
3. Opus uses the MCP tool `get_kanban_state` to find all 11 plans, adds high detail to each, and recommends which agents should handle them — all in a single turn for the cost of **1 quota request**
4. The plugin parses the plans and records Opus' complexity recommendations to the database
5. Press **Advance All Plans** at the top of the CLI-BAN — high-complexity tasks auto-route to Copilot CLI (Opus), while low-complexity boilerplate routes to Gemini CLI (Flash)
6. Each terminal processes all its assigned plans in a single turn using native subagents — Gemini CLI implements 9 low-complexity plans for **1 quota request**, Copilot implements 2 high-complexity plans for **3 quota requests**
7. When all tasks finish, press **Advance All Plans** in the coder columns to send a review request to Gemini CLI, which uses its native subagents to compare all 11 implementations against the plans

**Result:** 11 tasks fully architected, implemented, and reviewed for the cost of exactly **1 Windsurf quota request** and **4 total quota requests** across Copilot and Gemini. The execution load was distributed across multiple providers, keeping you well under the rate limits of any single service. Doing this one-by-one in Windsurf would burn through your entire daily quota on planning alone.

**Video guide:** Setup videos are linked on the project page.


## Quick Start

1. Open the **Switchboard sidebar** (click the icon in the activity bar).
2. Click **Setup** → **Initialise**. This auto-configures the MCP for Antigravity, Windsurf, and VS Code-compatible IDEs in one click.
3. Enter your CLI startup commands in Setup (e.g., `copilot --allow-all-tools`, `gemini`, `codex --full-auto`), save, then click **Open Terminals**.
4. Authenticate in each terminal and choose your models.
5. Draft a plan using `/chat` in your AI chat, refine it, or click **Create Plan** in the CLI-BAN.
6. Drag-and-drop plans on the **CLI-BAN Routing Board**, use the **Advance All** buttons, or use sidebar **Send** buttons to dispatch work to your agents.


## Features

### CLI-BAN Routing Board

The CLI-BAN is the central pipeline control surface. Each column represents an agent role, and each card is a plan. Think of it less as a project management board and more as a stateless execution trigger — plans enter, get routed to the right agent, and exit as completed work.

Because the CLI-BAN stores all plan state locally in SQLite, it enables asynchronous, multi-day workflows that ephemeral chat windows simply cannot support. You can plan on Monday, execute on Tuesday, and review on Wednesday — without losing context or being forced to keep a chat session alive.

- **Drag-and-drop** individual cards, multi-select cards, or use buttons to advance all cards to the next stage
- **Complexity-based auto-routing** — when you advance plans, the plugin reads the complexity classification and routes high-complexity tasks to your Lead Coder (e.g. Opus) and low-complexity tasks to your standard Coder (e.g. GPT, Flash)
- **Custom agents** — Switchboard ships with 5 built-in agent roles, but you can add your own roles to the CLI-BAN and customize their automated prompts via the setup menu

### Delayed Implementation (The Agile Advantage)

Standard "vibe coding" — the plan-code-plan-code loop in a single IDE chat — forces you to burn through your daily quotas linearly. If you hit your Windsurf limit mid-feature, your work stops until tomorrow. Your context is trapped in an ephemeral chat window, and you're held hostage by API reset timers.

Switchboard decouples planning from execution, acting like a true Agile development team. Spend your entire Day 1 Windsurf Opus quota doing deep architectural planning and storing those blueprints in the CLI-BAN. Then walk away. On Day 2 (when quotas reset) or using a fleet of cheaper background agents (Gemini CLI, Claude Code), you execute the sprint.

**The workflow:**
- **Monday:** Burn 15 Windsurf Opus messages planning a 2-week sprint. Store all plans in the CLI-BAN.
- **Tuesday–Friday:** Execute the backlog using Gemini CLI and Copilot, preserving your Windsurf quota for emergencies.
- **Next Monday:** Use your refreshed Windsurf quota for the next sprint's planning phase.

You plan when you want. You code when the quota allows. The CLI-BAN holds the state, so you're never forced to execute immediately or lose your work.

### Maximum Context Efficiency (The Epic Prompt)

Every chat message you send forces the model to reload your project context and burn a daily quota request. Send 10 separate messages? That's 10 context loads, 10 codebase searches, and 10 quota requests gone — potentially half your daily Windsurf allowance on what should have been one batch of work.

Switchboard flips this. Queue up your tasks on the CLI-BAN, then dispatch them as a single **epic prompt**. The model initializes once, searches the codebase once, and processes all tasks in a single turn. Use a cheaper model (Gemini CLI, Claude Code, Antigravity) to create highly detailed plans, then send them to Copilot or Windsurf Opus to implement in one prompt.

**One prompt. One context load. All tasks done.**

### Load Balancing & Rate Limit Survival

Switchboard acts as a **load balancer for AI subscriptions**. Every provider is now applying limits:

- **Windsurf** enforces strict daily message quotas (7–27/day for premium models)
- **Copilot** actively throttles heavy users mid-session
- **Gemini CLI** applies usage caps that reset on unpredictable schedules

**Critical:** Dumping 10 tasks into Copilot at once, even on a timer, is a fast track to getting rate-limited or flagged for automated abuse. Switchboard prevents this by letting you map different CLI-BAN columns to different CLI tools. Send your heavy architectural logic to Copilot, your boilerplate to Gemini Flash, and your data formatting to Claude Code — distributing the execution load so no single API ever gets hot.

When one provider throttles you, Switchboard lets you reroute instantly. Copilot down? Send the CLI-BAN queue to Gemini CLI. Windsurf Opus quota exhausted for the day? Fall back to Claude Code for planning and save your remaining requests for final review. Your pipeline never stalls because no single point of failure can block it.

### AUTOBAN Automation

No API keys, and no wasted tokens on spawning automation processes. Instead, Switchboard spins up multiple terminals per role — each running a *different* CLI tool — and rotates plans gatling-style. Every few minutes a plan is sent to an agent, and by the time the rotation completes, the first terminal is free for a new plan. Each CLI is also instructed to use its own native subagent features, so at full speed you have multiple terminals each running their own subagents to chew through a large backlog.

This isn't just about speed — it's about **safe concurrency**. Staggering plans across different agent terminals (Copilot, Gemini CLI, Claude Code) is how you maintain a healthy, unflagged developer account. No single API sees enough concentrated traffic to trigger abuse detection.

Use the **Advance All** button to send each task in a column to the next agent on a timer. For example, create 10 plans, advance them all to the Planner on a 5-minute timer. Come back in an hour and advance them all to the Lead Coder on a 10-minute timer.

### Plan Review Comments

Highlight text within a plan to send a targeted comment to the Planner agent referencing that exact text, enabling precise planning improvement conversations. A great use of this is to run Claude Code Sonnet in the Planner terminal — after Copilot/Windsurf Opus writes the initial plans, ask Sonnet questions about them without spending Copilot quota.

### Google Jules Integration

If you're running low on quota and have a Google Pro subscription, press a button in the CLI-BAN to start sending tasks to Jules, which gives you 100 free Gemini requests per day. This works well for low-priority backlog items.

### Cross-IDE Workflows

Plan with Antigravity and Gemini CLI, then move the plan to Windsurf running Opus to implement or review. In the CLI-BAN or sidebar, click **COPY** to copy the plan link to your clipboard, then paste it into your other IDE's chat.


## Personality & Aesthetic

Switchboard has a distinct flavor. The UI is a minimalist, diegetic **sci-fi command center** — pipeline control surfaces, routing boards, and system status panels designed to feel like you're operating a starship engineering console, not a project management tool.

More importantly, the built-in **Reviewer** agent ships with a **"Grumpy Principal Engineer"** persona. This isn't a gimmick — it's a practical solution to a real problem. When you're reviewing large batches of automated code output, dry AI-generated reviews blur together into an unreadable wall of polite suggestions. The Grumpy Engineer persona enforces strict code accuracy while making the output genuinely engaging and highly readable. Every review reads like feedback from a battle-scarred staff engineer who has seen your exact mistake deployed to production before — pointed, memorable, and impossible to skim past. It turns the most tedious part of the pipeline (reading 11 code reviews in a row) into something you actually want to read.


## NotebookLM Airlock

The Airlock feature bridges your IDE and Google's NotebookLM, giving you quota-free sprint planning. NotebookLM gives Google Pro subscribers unlimited Gemini Pro use in a sandboxed environment — excellent for planning without burning IDE quotas.

For example, if you use Antigravity Gemini Pro for planning, you exhaust your weekly Pro quota in about 10 plans. With Airlock, you use **0 quota** on 10 plans.

1. Open the **Airlock** tab and click **Bundle Code** — creates docx bundles of your repo in `.switchboard/airlock/`, plus a manifest and a "How to Plan" skill
2. Open NotebookLM, create a new notebook, upload the entire airlock folder as sources
3. Ask NotebookLM to "follow the How to Plan guide and generate plans for every task in the New column"
4. Copy the output, then use the **Import from Clipboard** button at the top of the CLI-BAN — Switchboard saves each plan into your database
5. Use the CLI-BAN to assign to agents as normal

The `manifest.md` file included in the Airlock folder maps your repo: file locations across bundles, file sizes, and any introductory comments at the top of each file. The Airlock panel also includes an option to have your Analyst agent add explanatory comments to each file, which then get pulled into the manifest.

### Why NotebookLM?

NotebookLM reads all source files fully instead of truncating the middle like other web AI tools. The only caveat is that it truncates code blocks in markdown/txt, which is why Switchboard converts code into docx prose.


## Automated Pipelines

The sidebar includes panels for asynchronous team automation:

| Command | What it does |
| :--- | :--- |
| `Pipeline` | Every 10 minutes, picks an open plan and passes it to the next agent in your chain (Planner → Coder → Reviewer). |
| `Auto Agent` | Sends the active plan to Planner, Lead Coder, and Reviewer on a 7-minute timer between stages. |
| `Lead + Coder` | Reads the plan's complexity split and routes low/medium work to the Coder, complex work to the Lead Coder. |
| `Coder + Reviewer` | Sends the plan to the Coder, then asks the Reviewer to verify — lifts cheap coding quality without needing Opus. |


## Agent Roles & Routing Strategies

Switchboard ships with 5 built-in agent roles. You can add custom roles via the setup menu (e.g. a "Frontend Coder" that only works on UI tasks).

| Role | Recommended tool | Purpose |
| :--- | :--- | :--- |
| Lead Coder | Copilot CLI (Opus 4.6) | Large feature implementation |
| Coder | Qwen, Gemini Flash 3, Codex 5.3 Low | Boilerplate and routine work |
| Planner | Codex 5.3 High, Gemini 3.1 CLI | Plan hardening and edge cases |
| Reviewer | Codex 5.3 High | Bug finding and verification |
| Analyst | Qwen, Gemini Flash 3 | Research and investigation |

### Example Routing Strategies

The key to surviving daily quotas is choosing the right model for each phase — never waste a premium request on work a cheaper model can handle.

- **The Quota-Free Sprint:** Plan in NotebookLM (Airlock) using zero IDE quota, code with Gemini CLI (Flash), and reserve Windsurf strictly for final architectural review. Your premium quota is untouched until the last mile.
- **The Balanced Team:** Plan with Sonnet 3.5 in Claude Code, distribute execution across Copilot (complex logic) and Gemini CLI (boilerplate), and save your Windsurf Opus quota (7–27 messages/day) exclusively for the final PR review pass. Every tier of your subscription stack does the job it's cheapest at.
- **The Throttle Pivot:** Start the day coding in Copilot. When Copilot throttles you mid-afternoon, reroute remaining CLI-BAN tasks to Gemini CLI without losing momentum. Switch back to Copilot tomorrow when your limits reset.


## IDE Chat Workflows

Use these within the Antigravity chat to replicate sidebar or CLI-BAN actions. *The buttons and CLI-BAN are generally faster since they are programmatically controlled.*

| Command | What it does |
| :--- | :--- |
| `/chat` | Ideation mode — discuss requirements before any plan is written. |
| `/improve-plan` | Deep planning, dependency checks, and adversarial review in one pass. |
| `/challenge` | Internal adversarial review pass (advisory-only, no CLI-BAN auto-move). |
| `/handoff` | Route sanity-checking for micro-specs to a CLI agent; ends at spec decomposition. |
| `/handoff-lead` | Send everything to your Lead Coder agent in one shot. |
| `/handoff-chat` | Copy the plan to the clipboard for pasting into Windsurf or another IDE. |
| `/handoff-relay` | Current model does the complex work, then pauses for a model switch. |
| `/accuracy` | High-precision implementation mode with mandatory self-review gates. |

> Use `--all` with any handoff to skip complexity splitting and send the whole plan.


## Trust, Account Safety & The ToS

Switchboard was built to be completely local. **There are no proxy servers, no external API keys, and no ToS violations.**

The coordination layer is strictly file-based. Switchboard uses the official VS Code `terminal.sendText` API to automate agents running in your own terminals, under your own standard authentication. Everything happens entirely on your machine. [Read the architectural analysis here.](docs/ToS_COMPLIANCE.md)

## Architecture

* **VS Code Extension:** Manages terminals, sidebar UI, CLI-BAN Routing Board, plan watcher, and inbox watcher.
* **Bundled MCP Server:** Exposes tools to agents (`send_message`, `check_inbox`, `get_kanban_state`, `start_workflow`, `run_in_terminal`, etc.).
* **SQLite Database:** Stores plans, routing state, and complexity classifications locally.
* **File Protocol:** All coordination happens via `.switchboard/` in your workspace — transparent, auditable, and entirely local.

## Privacy & License
No telemetry. No external servers. All coordination data is workspace-local. Open source — MIT License.

[GitHub](https://github.com/TentacleOpera/switchboard/) · [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=TentacleOpera.switchboard)
