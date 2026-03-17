'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

async function run() {
    const providerPath = path.join(process.cwd(), 'src', 'services', 'TaskViewerProvider.ts');
    const providerSource = await fs.promises.readFile(providerPath, 'utf8');

    assert.ok(
        providerSource.includes('private _buildReviewerExecutionIntro(planCount: number): string'),
        'Expected shared reviewer execution intro helper for manual/autoban parity.'
    );
    assert.ok(
        providerSource.includes('private _buildReviewerExecutionModeLine(expectation: string): string'),
        'Expected shared reviewer execution mode helper for manual/autoban parity.'
    );
    assert.ok(
        providerSource.includes('The implementation for each of the following ${planCount} plans is complete. Execute a direct reviewer pass in-place for each plan.'),
        'Expected reviewer batch intro to describe implementation review rather than plan review.'
    );
    assert.ok(
        providerSource.includes('Review the implementation/code against the plan requirements, not the plan text itself.'),
        'Expected reviewer batch prompt to anchor review against implementation/code and plan requirements.'
    );
    assert.ok(
        providerSource.includes('Report concrete findings and validation results for that plan.'),
        'Expected reviewer batch prompt to request per-plan review findings/results.'
    );
    assert.ok(
        !providerSource.includes('Please review the following ${plans.length} plans.'),
        'Expected the old ambiguous reviewer batch intro to be removed.'
    );
    assert.ok(
        !providerSource.includes('Review each plan independently and report concrete findings per plan.'),
        'Expected the old generic reviewer batch wording to be removed.'
    );
    assert.ok(
        providerSource.includes('const reviewerExecutionIntro = this._buildReviewerExecutionIntro(1);'),
        'Expected manual reviewer prompts to reuse the shared reviewer intro helper.'
    );
    assert.ok(
        /For each plan:\r?\n\s*1\. Use the plan file as the source of truth for the review criteria\./.test(providerSource),
        'Expected batch reviewer prompt to retain per-plan isolation guidance.'
    );

    console.log('autoban reviewer prompt regression test passed');
}

run().catch((error) => {
    console.error('autoban reviewer prompt regression test failed:', error);
    process.exit(1);
});
