**Switchboard: I built a drag and drop AI orchestration tool because I wanted to code one-handed**

*What's happening here: Dragged three cards to the Lead Coder column - Copilot received a unified automatic prompt to use subagents to complete each plan. Meanwhile, another button generated a code review prompt for Windsurf Opus and auto-moved those plans to the Reviewed column. Another button generated a prompt for Antigravity Flash to analyze a selected card in the New column.*

---

Switchboard is a different approach to AI orchestration:

- **A visual kanban auto-triggers agents via drag and drop** — run entire agent teams without typing a single prompt
- **Works across both CLI and IDE agents** - Windsurf, Cursor, Antigravity, Copilot CLI, Gemini CLI, whatever: combine all your subscriptions, not just CLIs
- **Batch and parallelise** — send entire columns of plans to agents in one prompt, with instructions to spawn subagents. Multiple tasks execute simultaneously without you doing anything.
- **Assign by complexity** — put an Opus subscription in the Planner slot and it will organise which tasks can be sent to cheap agents based on a complexity threshold you set, so you can eke all possible value out of cheap agents
- **Amplify other tools** — put Claude Code, OpenCode, Copilot Squads, or anything else into the kanban to route between them
- **No repo pollution** — kanban state, routing rules and archived plans live in a multi-repo database on Google Drive, so you can share across machines without random files appearing in every commit

With Switchboard, you can have Windsurf plan, route dynamically to Copilot Opus or Gemini CLI Flash based on the complexity your planner agent decides, then tell Opus in Cursor to review everyone's work. All while drinking a beer, since you only need one hand to operate Switchboard.

---

Install from any VS Code marketplace. Full details in the readme: [link]