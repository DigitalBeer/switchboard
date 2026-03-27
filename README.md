# Switchboard

**Save money by combining your AI subscriptions into one seamless pipeline**

Some AI coding tools force a choice between the $20 peasant tier and the $200 elite tier. Switchboard gives you a third option — combine multiple mid-tier subscriptions (like Google Pro, Copilot Pro, and Windsurf) into a single workflow, then apply intelligent routing to make them last. 

Switchboard uses a **AUTOBAN** as the central pipeline control surface to automate CLI agents, IDE chat agents, and NotebookLM in one place, effectively extending your premium quota by up to 50%.

Unlike other orchestration frameworks like OpenCode, Switchboard uses no API keys and no orchestrator agent. Most systems burn API credits coordinating between models, or run a persistent meta-agent that costs tokens just to exist. Switchboard does neither — your existing subscriptions do the work, and the routing logic runs locally for free.

*By Grabthar's Hammer, what a savings.*

Switchboard coordinates this with no authentication hacks. Just the official VS Code API (`terminal.sendText`) and a local SQLite database running in your repo. There are no proxy servers, no ToS breaches, and all coordination is local.

## What a real session looks like

Here's one workflow combining Windsurf, Copilot CLI, and Gemini CLI. Switchboard works across many combinations, this is just one example:

1. Enter your CLI agent startup commands into the setup menu. Switchboard boots them in VS Code terminals and tracks their PIDs so it can dispatch automated messages using the official VS Code API terminal.sendText.

2. Create 5 plans in the **AUTOBAN** (a kanban-style routing board for tasks and agents) and hit *Copy prompt for all plans*.

3. Paste into Windsurf. Opus reads the full board state via MCP, enriches each plan with detail, and produces a routing table. Every task gets a complexity rating and an agent recommendation.

4. Switchboard saves the routing table to a SQLite database and tracks each plan's current stage.

5. Hit the column controls to route all plans in one click. If Opus called all 5 plans simple, send the whole batch to Gemini Flash in Antigravity, Kimi in Windsurf, or whatever you have available. High-complexity tasks get routed to Opus in Copilot CLI. 

6. When done, hit *Move All Plans* again to send all plans to the Reviewed column and send a review request to Gemini CLI Pro, which compares every implementation against its plan.


## Features

### AUTOBAN

The AUTOBAN is the central pipeline control surface. Each column represents an agent role, and each card is a plan. Think of it less as a project management board and more as a stateless execution trigger — plans enter, get routed to the right agent, and exit as completed work.

- **Drag-and-drop** individual cards, multi-select cards, or use buttons to advance all cards to the next stage
- **Complexity-based auto-routing** — when you advance plans, the plugin reads the complexity classification and routes high-complexity tasks to your Lead Coder (e.g. Opus) and low-complexity tasks to your standard Coder (e.g. GPT, Flash)
- **Custom agents** — Switchboard ships with 5 built-in agent roles, but you can add your own roles to the AUTOBAN and customize their automated prompts via the setup menu

### Persistent state tracking

Because the AUTOBAN stores all plan state locally in SQLite, it enables asynchronous, multi-day workflows. You can plan on Monday, execute on Tuesday, and review on Wednesday — without losing context or being forced to keep a chat session alive.

Standard "vibe coding" — the plan-code-plan-code loop in a single IDE chat — forces you to burn through your daily quotas linearly. If you hit your Windsurf limit mid-feature, your work stops until tomorrow. Your context is trapped in an ephemeral chat window, and you're held hostage by API reset timers.

Switchboard holds the context for you so you can spread work out across days to better manage quota spend.

### Plan Import

Switchboard watches any folder you specify for new plans and imports them into the AUTOBAN automatically. Point it at the Antigravity Brain folder, a Claude Code output directory, or wherever your preferred planning framework drops files — it doesn't matter. This makes Switchboard compatible with any planning workflow, not just the built-in one. 


### Pair Programming Mode

Pair programming splits high-complexity plans into two streams: Lead Coder handles the complex work, while a cheaper Coder agent (e.g. Gemini Flash) handles the boilerplate simultaneously. This can reduce your primary IDE agent quota by up to 50%.

Enable pair programming with the **Pair Programming** toggle at the top of the AUTOBAN. There are three ways it works, depending on your setup:

| Mode | How to trigger | Lead gets | Coder gets |
| :--- | :--- | :--- | :--- |
| **CLI Parallel** | Drag a high-complexity card to Lead Coder column (Coder column in CLI mode) | CLI terminal dispatch | CLI terminal dispatch |
| **Hybrid** | Click the **Pair** button on a card (Coder column in CLI mode) | Clipboard prompt → paste to IDE chat | CLI terminal dispatch |
| **Full Clipboard** | Click the **Pair** button on a card (Coder column in Prompt mode) | Clipboard prompt → paste to IDE chat | Notification button → clipboard prompt |

**CLI Parallel** is the default — both agents fire automatically in separate terminals. **Hybrid** is for when you want to use your IDE chat (Windsurf, Antigravity) for the complex work while a CLI agent handles the easy parts. **Full Clipboard** is for IDEs where you prefer pasting all prompts manually. For example, in Windsurf, paste the first prompt into a Cascade chat with Opus. Then, click the notification to generate the second prompt, and paste the second prompt into a Cascade chat with Gemini Flash High. 

To set up Full Clipboard mode: set the Coder column's drag-and-drop mode to **Prompt** using the toggle icon in the column header, then click the **Pair** button on any high-complexity card. 

#### Aggressive Pair Programming

Enable **Aggressive Pair Programming** in the Setup sidebar to shift more tasks to the Coder agent. This tells the planner to assume the Coder is highly competent, classifying only truly complex work (new architectures, security logic, concurrency) as high complexity for the Lead. Everything else goes to the Coder.

This saves tokens — but the code review step becomes more important. With more work on the Coder, the Reviewer agent in the CODE REVIEWED column is your primary quality gate. Make sure you have a capable model assigned to the Reviewer role when using aggressive mode.

### Task Batching

Select multiple cards in the AUTOBAN to send them as a batch to an agent. This saves quota because every time you send a prompt, you're also sending hidden system instructions and asking the agent to spin up research tasks. Batching means the agent only does this once. All task batches include an instruction for the agent to use its native subagents if available, so that you still get focused attention on each task. 

### AUTOBAN Automation

Press the **START AUTOBAN** button at the top of the AUTOBAN to start processing plans through stages on an automated timer. This automation uses no API keys, and does not waste quota on 'orchestrator' agents. Instead, Switchboard spins up multiple terminals per role, with each terminal running a separate CLI agent, and rotates plans gatling-style. Every few minutes a plan is sent to an agent, and by the time the rotation completes, the first terminal is free for a new plan. Each CLI is also instructed to use its own native subagent features, so at full speed you have multiple terminals each running their own subagents to chew through a large backlog.

Because each CLI terminal is only being triggered every few minutes, this automation does not trigger any provider rate throttling. 


### Plan Review Comments

Highlight text within a plan to send a targeted comment to the Planner agent referencing that exact text, enabling precise planning improvement conversations. A great use of this is to run Claude Code Sonnet in the Planner terminal — after Copilot/Windsurf Opus writes the initial plans, ask Sonnet questions about them without spending Copilot quota.

### Google Jules Integration

If you're running low on quota and have a Google Pro subscription, press a button in the AUTOBAN to start sending tasks to Jules, which gives you 100 free Gemini requests per day. This works well for low-priority backlog items.

### Cross-IDE Workflows

Plan with Antigravity and Gemini CLI, then move the plan to Windsurf running Opus to implement or review. In the AUTOBAN or sidebar, click **COPY** to copy the plan link to your clipboard, then paste it into your other IDE's chat along with an automatically generated implementation prompt.


## Personality & Aesthetic

Switchboard has a distinct flavor. The UI is a minimalist, diegetic **sci-fi command center** — pipeline control surfaces, routing boards, and system status panels designed to feel like you're operating a starship engineering console, not a project management tool.

More importantly, the built-in **Reviewer** agent ships with a **"Grumpy Principal Engineer"** persona. This isn't a gimmick — it's a practical solution to a real problem. When you're reviewing large batches of automated code output, dry AI-generated reviews blur together into an unreadable wall of polite suggestions. The Grumpy Engineer persona enforces strict code accuracy while making the output genuinely engaging and highly readable. Every review reads like feedback from a battle-scarred staff engineer who has seen your exact mistake deployed to production before — pointed, memorable, and impossible to skim past. 


## NotebookLM Airlock

The Airlock feature bridges your IDE and Google's NotebookLM, giving you quota-free sprint planning. NotebookLM gives Google Pro subscribers unlimited Gemini Pro use in a sandboxed environment — excellent for planning without burning IDE quotas.

For example, if you use Antigravity Gemini Pro for planning, you exhaust your weekly Pro quota in about 10 plans. With Airlock, you use **0 quota** on 10 plans.

1. Open the **Airlock** tab and click **Bundle Code** — creates docx bundles of your repo in `.switchboard/airlock/`, plus a manifest and a "How to Plan" skill
2. Open NotebookLM, create a new notebook, upload the entire airlock folder as sources
3. Ask NotebookLM to "follow the How to Plan guide and generate plans for every task in the New column"
4. Copy the output, then use the **Import from Clipboard** button at the top of the AUTOBAN — Switchboard saves each plan into your database
5. Use the AUTOBAN to assign to agents as normal

The `manifest.md` file included in the Airlock folder maps your repo: file locations across bundles, file sizes, and any introductory comments at the top of each file. 

## IDE Chat Workflows

Use these within the Antigravity or Windsurf chat to quickly get a plan generated and inserted into the Kanban. Switchboard reads the Antigravity Brain folder and adds any plans created into the AUTOBAN for you. 

| Command | What it does |
| :--- | :--- |
| `/chat` | Ideation mode — discuss requirements before any plan is written. |
| `/improve-plan` | Deep planning, dependency checks, and adversarial review in one pass. |



## Trust, Account Safety & The ToS

Switchboard was built to be completely local. **There are no proxy servers, no external API keys, and no ToS violations.**

The coordination layer is strictly file-based. Switchboard uses the official VS Code `terminal.sendText` API to automate agents running in your own terminals, under your own standard authentication. Everything happens entirely on your machine. [Read the architectural analysis here.](docs/ToS_COMPLIANCE.md)

## Architecture

* **VS Code Extension:** Manages terminals, sidebar UI, AUTOBAN, plan watcher, and inbox watcher.
* **Bundled MCP Server:** Exposes tools to agents (`send_message`, `check_inbox`, `get_kanban_state`, `start_workflow`, `run_in_terminal`, etc.).
* **SQLite Database:** Stores plans, routing state, and complexity classifications locally.
* **File Protocol:** All coordination happens via `.switchboard/` in your workspace — transparent, auditable, and entirely local.

## Privacy & License
No telemetry. No external servers. All coordination data is workspace-local. Open source — MIT License.

[GitHub](https://github.com/TentacleOpera/switchboard/) · [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=TentacleOpera.switchboard)
