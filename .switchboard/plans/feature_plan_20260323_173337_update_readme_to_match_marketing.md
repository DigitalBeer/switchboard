# Update Readme to match marketing

## Goal
The marketing.md doc in the docs folder has been refined through many revisions, but the project readme still is just a draft. Please refine the readme to match the marketing doc benefits (C:\Users\patvu\Documents\GitHub\switchboard\docs\marketing.md). It should stil lread like a readme with expanded feature descriptions ,but the marketing doc has clearer benefit descriptions.

Importantly, this plugin is an alternative to opencode and other orchestriton frameworks, as specified in the marketing doc. 

## User Review Required
> [!NOTE]
> Please review the new tone of the README to ensure it strikes the right balance between marketing (value proposition) and technical utility.

## Complexity Audit
### Routine
- Update the introduction of `README.md` to use the refined hook, cost-saving benefits, and API-key-free architecture points from `marketing.md`.
- Ensure the README explicitly positions Switchboard as an alternative to OpenCode and other orchestration frameworks without orchestrator agents.
- Maintain existing technical documentation, workflows, and feature lists.
### Complex / Risky
- None

## Edge-Case & Dependency Audit
- **Race Conditions:** N/A for documentation updates.
- **Security:** N/A for documentation updates.
- **Side Effects:** N/A for documentation updates.
- **Dependencies & Conflicts:** No conflicts with other pending Kanban plans.

## Adversarial Synthesis
### Grumpy Critique
You're just going to regurgitate marketing copy into a README? A README is for developers, not venture capitalists! If you just copy-paste the marketing fluff, users won't know how to install the damn thing, configure it, or what dependencies it needs. And what about this 'alternative to opencode' claim? Where's the proof? Where's the technical distinction? A README needs setup instructions, architecture context, and a clear 'Getting Started' section, not just a sales pitch about pair programming arbitrage!

### Balanced Response
Grumpy makes a fair point about the target audience. While we must integrate the superior benefit descriptions and the value proposition (especially the cost-saving arbitrage and zero-API-key architecture) from `marketing.md`, we cannot sacrifice the technical utility of the README. I will structure the updated README to lead with the strong hook from the marketing document, but retain all essential technical sections: Example Workflow, Setup, Features (enhanced with marketing context), and Architecture.

## Proposed Changes
> [!IMPORTANT]
> **MAXIMUM DETAIL REQUIRED:** Provide complete, fully functioning code blocks. Break down the logic step-by-step before showing code.

### README
#### [MODIFY] `README.md`
- **Context:** The current README introduction is a draft and lacks the polished benefit descriptions found in `marketing.md`. We need to update the introductory section to reflect the cost savings, lack of orchestrator meta-agents, and alternative positioning to OpenCode, while keeping the rest of the file intact.
- **Logic:**
  1. Replace the first 14 lines of `README.md` with the refined copy from `marketing.md`, keeping the markdown link to the UI screenshot.
  2. Synthesize the "save money by combining your AI subscriptions" hook.
  3. Include the comparison with OpenCode and orchestration frameworks.
- **Implementation:**
```diff
--- README.md
+++ README.md
@@ -1,14 +1,14 @@
 # Switchboard
 
-**Combine multiple subscriptions to extend daily quotas, stay under rate limits and double the value of your subcriptions**
+**Save money by combining your AI subscriptions into one seamless pipeline**
 
-Switchboard is a VS Code extension that combines CLI agents (Copilot CLI, Claude Code, Gemini CLI, Codex), IDE chat agents (Windsurf, Antigravity), local LLMs and also(!) NotebookLM into a single pipeline. It uses a **CLI-BAN Routing Board** as the central pipeline control surface — create plans, drag-and-drop them into new coluns to trigger CLI agents, batch entire sprints into single prompts, and auto-route work by complexity.
+Most AI coding tools force a choice between the $20 peasant tier and the $200 elite tier. Switchboard gives you a third option — combine multiple mid-tier subscriptions (like Google Pro, Copilot Pro, and Windsurf) into a single workflow, then apply intelligent routing to make them last. It uses a **CLI-BAN Routing Board** as the central pipeline control surface to automate CLI agents, IDE chat agents, and NotebookLM in one place, effectively extending your premium quota by up to 50%.
 
-The pair programming mode can also increase chat-based quotas like Windsurf or Antigravity by as much as 50%. This offloads boilerplate work from Opus in Windsurf to Gemini CLI Flash or another cheap CLI of your choice. Windsurf Opus gets sent the complex part of the plan, Flash gets sent the simple parts of the plan, then Opus reviews Flash's work. 
+Unlike other orchestration frameworks like OpenCode, Switchboard uses no API keys and no orchestrator agent. Most systems burn API credits coordinating between models, or run a persistent meta-agent that costs tokens just to exist. Switchboard does neither — your existing subscriptions do the work, and the routing logic runs locally for free.
 
-Ultimately, Switchboard gives you the option of combining smaller subscriptions into a single workflow instead of having to spend $100+ for a Claude Max or Google Ultra subscription. With Google Pro ($20), Copilot Pro ($10) and Windsurf ($20) you can achieve similar results for half the cost. 
+*By Grabthar's Hammer, what a savings.*
 
-*By Grabthar's Hammer, what a savings.*
-
-Switchboard achieves this with no authentication hacks, no API keys. Just the official VS Code API (`terminal.sendText`) and a local SQLite database running in your repo. Unlike other frameworks like OpenCode, you're not burning tokens on automation, and there's no danger of breaching ToS. 
+Switchboard coordinates this with no authentication hacks. Just the official VS Code API (`terminal.sendText`) and a local SQLite database running in your repo. There's no proxy servers, no ToS breaches, and all coordination is local.
 
 ![Switchboard](https://raw.githubusercontent.com/TentacleOpera/switchboard/main/docs/switchboardui.png)
```
- **Edge Cases Handled:** Documentation changes do not introduce edge cases. Technical sections remain intact.

## Verification Plan
### Automated Tests
- Check markdown formatting rendering in preview.

## Open Questions
- None
