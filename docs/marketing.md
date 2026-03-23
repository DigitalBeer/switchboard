**Switchboard: save money by combining your AI subscriptions into one seamless pipeline**

What's happening in this screenshot: Opus running in Windsurf is using Switchboard's pair programming mode to offload work to Gemini CLI Flash. Opus estimated it saved 35% of its token spend, and made coding 50% faster. That's making your Windsurf subscription 35% more valuable just by flipping a switch.

Most AI coding tools force a choice between the $20 peasant tier and the $200 rich mahogany tier. Switchboard gives you a third option — combine multiple mid-tier subscriptions into a single workflow, then apply intelligent routing to make them last. Google Pro + Copilot Pro + Windsurf runs you $50 and goes almost as far.

Unlike other orchestration frameworks, Switchboard uses no API keys and no orchestrator agent. Most systems burn API credits coordinating between models, or run a persistent meta-agent that costs tokens just to exist. Switchboard does neither — your existing subscriptions do the work, and the routing logic runs locally for free. 

Open source and security-reviewed by beta testers. No API keys, no proxy servers, no ToS breaches. Already over a hundred GitHub stars.

## What a real session looks like

Here's one workflow combining Windsurf, Copilot CLI, and Gemini CLI. Switchboard works across many combinations, this is just one example:

1. Enter your CLI agent startup commands into the setup menu. Switchboard boots them in VS Code terminals and tracks their PIDs so it can dispatch automated messages using the official VS Code API terminal.sendText.

2. Create 5 plans in the **CLI-BAN** (a kanban-style routing board for tasks and agents) and hit *Copy prompt for all plans*.

3. Paste into Windsurf. Opus reads the full board state via MCP, enriches each plan with detail, and produces a routing table. Every task gets a complexity rating and an agent recommendation.

4. Switchboard saves the routing table to a SQLite database and tracks each plan's current stage.

5. Hit the column controls to route all plans in one click. If Opus called all 5 plans simple, send the whole batch to Gemini Flash in Antigravity, Kimi in Windsurf, or whatever you have available. High-complexity tasks get routed to Opus in Copilot CLI. 

6. When done, hit *Move All Plans* again to send all plans to the Reviewed column and send a review request to Gemini CLI Pro, which compares every implementation against its plan.

Now, if you want Opus doing everything, it can. You can spend $200 on a Claude Max subscription. But Opus can also tell you which tasks don’t need it. Switchboard just acts on what Opus recommends. Indeed, one highly effective workflow is to have Windsurf Opus plan, Antigravity Flash code, then have Opus in the Reviewer slot to fix any mistakes. Even if Flash only gets it 50% correct, Flash costs 10 times less than Opus, and that’s 50% less code for Opus to write. That’s highly effective arbitrage that Switchboard enables. 

## Standout features

**Pair programming mode** preserves your premium quota by offloading boilerplate to a cheaper agent, then sending your best model only the complex parts for implementation and review. This can effectively extend your quota by up to 50%.

**Persistent state** is what makes cross-subscription routing work. Every plan's stage, complexity, and agent assignment is tracked locally.

**NotebookLM Airlock** automatically bundles your entire repo into NotebookLM-compatible `.docx` files. Upload them, get planning responses back, and paste them straight into the database as plans — unlimited Gemini Pro for planning and bug hunting, at zero token cost.

**Plan review** lets you highlight any part of a plan and send it back to your planner agent with inline comments — the same workflow popularised in Antigravity. Useful when a plan needs tightening before you commit it to implementation.

**AUTOBAN** rotates plans through CLI-BAN stages on a timer, no orchestrator agent needed.

**Grumpy Principal Engineer persona** is injected at architecture and review stages. Triggered by half-baked plans and bad code. 

**Google Jules integration** lets you offload tasks to Jules when quota runs low — 100 free Gemini requests a day on a Google Pro subscription.


Install from any VS Code marketplace. Open source repo here: [link]