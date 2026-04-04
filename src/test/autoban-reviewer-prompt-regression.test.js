'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

async function run() {
    const builderPath = path.join(process.cwd(), 'src', 'services', 'agentPromptBuilder.ts');
    const builderSource = await fs.promises.readFile(builderPath, 'utf8');

    assert.ok(
        builderSource.includes('function buildReviewerExecutionIntro(planCount: number): string'),
        'Expected shared reviewer execution intro helper.'
    );
    assert.ok(
        builderSource.includes('function buildReviewerExecutionModeLine(expectation: string): string'),
        'Expected shared reviewer execution mode helper.'
    );
    assert.ok(
        builderSource.includes('The implementation for each of the following ${planCount} plans is complete. Perform an advisory review for each plan.'),
        'Expected reviewer batch intro to describe advisory review rather than executor pass.'
    );
    assert.ok(
        builderSource.includes('assess the actual code changes against the plan requirements and produce a structured Review Report.'),
        'Expected reviewer batch prompt to anchor review against implementation/code and produce a structured Review Report.'
    );
    assert.ok(
        builderSource.includes('VERDICT: NOT READY'),
        'Expected reviewer batch prompt to include VERDICT system.'
    );
    assert.ok(
        builderSource.includes('ROUTE → FIXER'),
        'Expected reviewer batch prompt to include routing rules.'
    );

    assert.ok(
        builderSource.includes('When you output the adversarial critique (Grumpy and Balanced sections)'),
        'Expected reviewer prompt to include chat critique directive.'
    );

    assert.ok(
        !builderSource.includes('Apply code fixes for valid CRITICAL/MAJOR findings'),
        'Reviewer prompt must NOT contain executor language.'
    );
    assert.ok(
        builderSource.includes('You are a read-only reviewer. You do NOT edit files, run commands, or apply fixes.'),
        'Expected reviewer prompt to include read-only reviewer directive.'
    );

    console.log('autoban reviewer prompt regression test passed');
}

run().catch((error) => {
    console.error('autoban reviewer prompt regression test failed:', error);
    process.exit(1);
});
