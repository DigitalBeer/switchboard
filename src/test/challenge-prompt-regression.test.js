/**
 * Regression tests for optional inline challenge prompt wiring.
 * Run with: node src/test/challenge-prompt-regression.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const providerPath = path.join(__dirname, '..', 'services', 'TaskViewerProvider.ts');
const webviewPath = path.join(__dirname, '..', 'webview', 'implementation.html');

const providerSource = fs.readFileSync(providerPath, 'utf8');
const webviewSource = fs.readFileSync(webviewPath, 'utf8');

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        console.log(`  PASS ${name}`);
        passed++;
    } catch (error) {
        console.error(`  FAIL ${name}: ${error.message}`);
        failed++;
    }
}

function expectRegex(source, regex, message) {
    assert.match(source, regex, message);
}

function run() {
    console.log('\nRunning challenge prompt regression tests\n');

    test('provider parses with-challenge instruction flag', () => {
        expectRegex(
            providerSource,
            /private\s+_parsePromptInstruction\(instruction\?:\s*string\):\s*\{\s*baseInstruction\?:\s*string;\s*includeInlineChallenge:\s*boolean\s*\}/,
            'Expected TaskViewerProvider to expose prompt instruction parsing for optional challenge mode.'
        );
        expectRegex(
            providerSource,
            /if\s*\(\s*instruction\s*===\s*'with-challenge'\s*\)\s*\{\s*return\s*\{\s*baseInstruction:\s*undefined,\s*includeInlineChallenge:\s*true\s*\};/s,
            'Expected a bare with-challenge instruction to enable inline challenge without changing the base action.'
        );
    });

    test('lead and coder prompts only append challenge block conditionally', () => {
        expectRegex(
            providerSource,
            /const\s+inlineChallengeBlock\s*=\s*includeInlineChallenge\s*\?\s*`\\n\\n\$\{inlineChallengeDirective\}`\s*:\s*'';/,
            'Expected single-plan prompt construction to build an optional inline challenge block.'
        );
        expectRegex(
            providerSource,
            /\$\{planAnchor\}\$\{inlineChallengeBlock\}/,
            'Expected lead/coder single-plan prompts to append the challenge block only when enabled.'
        );
        expectRegex(
            providerSource,
            /const\s+challengeBlock\s*=\s*includeInlineChallenge\s*\?\s*`\\n\\n\$\{inlineChallengeDirective\}`\s*:\s*'';/,
            'Expected batch prompt construction to use an optional challenge block.'
        );
    });

    test('implementation view exposes opt-in challenge actions for lead and coder', () => {
        expectRegex(
            webviewSource,
            /challengeBtn\.innerText\s*=\s*'WITH CHALLENGE';/,
            'Expected the implementation webview to show a dedicated opt-in challenge action.'
        );
        expectRegex(
            webviewSource,
            /vscode\.postMessage\(\{\s*type:\s*'triggerAgentAction',\s*role:\s*roleId,\s*sessionFile:\s*sessionId,\s*instruction:\s*'with-challenge'\s*\}\);/s,
            'Expected the challenge action to dispatch the with-challenge instruction.'
        );
        expectRegex(
            webviewSource,
            /instruction:\s*'improve-plan'/,
            'Expected the planner action to use improve-plan rather than the legacy enhance instruction.'
        );
    });

    console.log(`\nResult: ${passed} passed, ${failed} failed`);
    if (failed > 0) {
        process.exit(1);
    }
}

run();
