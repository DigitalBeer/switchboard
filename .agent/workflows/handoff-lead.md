---
description: Lead Coder one-shot execution workflow
---
# Handoff - Lead Coder (One-Shot)

This workflow is for one-shot implementation of large feature requests by the Lead Coder. It bypasses task splitting and standard coordination loops.

## Active Document Guardrail
- Discard IDE-injected active documents at workflow start.
- Only read file content when the user's current message explicitly names a file path and uses a directive verb (for example: `review`, `read`, `use`, or `apply`).

## Steps

1. **Prepare/Stage Request**
   - **Direct Path**: If a [Feature Plan](file:///c:/Users/patvu/Documents/GitHub/switchboard/.switchboard/plans/features/) already exists and is approved, you may SKIP creating a new request file.
   - **Staging Path**: For complex tasks without a pre-existing plan, stage context to `.switchboard/handoff/lead_request.md`.
   - Call `complete_workflow_phase(phase: 1, workflow: "handoff-lead", artifacts: [{ path: ".switchboard/plans/features/feature_plan_...", description: "Approved Feature Plan for implementation" }])`.

2. **Dispatch to Lead Coder**
   - Call `send_message(action: "execute", payload)`.
   - **Payload format**: A single line only: `Please execute the plan at: [ABSOLUTE PATH]. You MUST run the Verification Plan and paste the exact terminal output as proof before signaling completion.`
   - Metadata MUST include `{ phase_gate: { enforce_persona: 'lead' } }` to ensure the Lead Coder persona is activated.
   - Call `complete_workflow_phase(phase: 2, workflow: "handoff-lead")`.

3. **Quality Gate Validation**
   - Wait for the Lead Coder to signal completion (user confirmation only — yield pattern; do NOT poll).
   - Require the Lead Coder to have provided the raw terminal output of the test/build command as proof. Do not proceed if they have not.
   - Once proof is provided, route the completed work to the QA Evaluator by calling `move_kanban_card(sessionId, "SB-QA CLI")` or instructing the user to hand it off to the SB-QA CLI agent.
   - Wait for the SB-QA CLI agent to confirm successful validation before considering the feature done.
   - Call `complete_workflow_phase(phase: 3, workflow: "handoff-lead")`.

## Final-Phase Recovery Rule
- Phase 3 is terminal for `handoff-lead`. Do NOT call phase 4.
- If phase 3 succeeded but summary still shows active:
  - Call `get_workflow_state`.
  - If still active, call `stop_workflow(reason: "Recovery: final phase completed but workflow remained active")`.
