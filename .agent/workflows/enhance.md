---
description: Deep plan improvement & structural auditing (System 2)
---

# Enhance — Deep Planning & Structural Audit

This workflow is for "System 2" thinking. It takes a minimalist plan drafted in `/chat` and hardens it through complexity analysis, edge-case identification, and detailed task splitting.

## Critical Constraints
- **NO IMPLEMENTATION**: You are strictly forbidden from writing code.
- **Switchboard Operator Persona**: You must operate as a senior systems analyst.
- **CONTENT PRESERVATION**: You are FORBIDDEN from deleting original implementation details, prose, or context. Your goal is to **APPEND** and **MERGE**, not replace.
- **SURGICAL EDITS ONLY**: Do NOT use `write_to_file` with `Overwrite: true` on existing plans. You MUST use surgical edit tools (e.g., `multi_replace_file_content`) to inject audits into the document while keeping 100% of the original content intact.
- **Structural Depth**: Your goal is to find what was missed in the initial chat, not simplify what was already there.

## Steps

1. **Context Loading**: 
   - Read the existing `implementation_plan.md` or `feature_plan_*.md`.
   - Read the `.switchboard/plans/antigravity_plans/` staging if applicable.
2. **Analysis Phase**:
   - Perform a **Complexity Audit**: Identify Band B (architectural) vs Band A (routine) tasks.
   - Perform an **Edge-Case Audit**: Identify potential race conditions, security holes, or side effects.
3. **Hardening**: 
   - Inject the audits and detailed verification steps into the existing document.
   - **DO NOT** remove existing "Proposed Changes" or technical deep-dives; instead, refine them to address the newly identified edge cases.
   - Standardize the H1 title and metadata without losing the original plan's unique identifiers.
4. **Presentation**:
   - Summarize the structural improvements made (what you added, not what you removed).
   - Recommend starting `/challenge` for an adversarial review (stress-testing) or `/handoff` for implementation.

## Governance
- Use standard AI review personas (Grumpy/Balanced) if the plan is high-risk.
- Ensure the plan is "handoff-ready" (zero ambiguity for the coder).
- **Bulk Action Warning**: If processing multiple plans, you must verify the merge for each file individually to ensure no data loss occurs. Use of bulk `write_to_file` on existing content is a protocol violation.
