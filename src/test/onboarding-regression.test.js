'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

async function run() {
    console.log('\nRunning onboarding regression test simulation\n');

    const htmlPath = path.join(process.cwd(), 'src', 'webview', 'implementation.html');
    const htmlSource = fs.readFileSync(htmlPath, 'utf8');

    const messages = [];
    
    // Mock VS Code API
    const dom = new JSDOM(htmlSource, {
        runScripts: "dangerously",
        beforeParse(window) {
            window.acquireVsCodeApi = () => ({
                postMessage: (msg) => messages.push(msg),
                getState: () => ({}),
                setState: () => {}
            });
        }
    });

    const { window } = dom;
    
    // The script in implementation.html runs immediately on load.
    // We need to wait for it to finish initialization.
    await new Promise(resolve => setTimeout(resolve, 100));

    // 1. Simulate receiving 'initialState' with needsSetup: true
    console.log('  -> Simulating initialState (needsSetup: true)');
    window.postMessage({ type: 'initialState', needsSetup: true }, '*');
    await new Promise(resolve => setTimeout(resolve, 50));

    // Verify _setupComplete is false (though it's a private variable in the script, 
    // we can check visibility of containers)
    const onboardingContainer = window.document.getElementById('onboarding-container');
    const mainContainer = window.document.getElementById('main-container');
    assert.ok(!onboardingContainer.classList.contains('hidden'), 'Onboarding should be visible');
    assert.ok(mainContainer.classList.contains('hidden'), 'Main container should be hidden');

    // 2. Simulate completing onboarding: 'setupStatus' with needsSetup: false
    console.log('  -> Simulating setupStatus (needsSetup: false)');
    messages.length = 0; // clear message log
    window.postMessage({ type: 'setupStatus', needsSetup: false }, '*');
    await new Promise(resolve => setTimeout(resolve, 50));

    // Verify containers swapped
    assert.ok(onboardingContainer.classList.contains('hidden'), 'Onboarding should be hidden after setup');
    assert.ok(!mainContainer.classList.contains('hidden'), 'Main container should be visible after setup');

    // 3. Verify that the requested messages were sent
    console.log('  -> Verifying requested state messages');
    const hasGetStartupCommands = messages.some(m => m.type === 'getStartupCommands');
    const hasGetVisibleAgents = messages.some(m => m.type === 'getVisibleAgents');

    assert.ok(hasGetStartupCommands, 'Should have requested getStartupCommands');
    assert.ok(hasGetVisibleAgents, 'Should have requested getVisibleAgents');

    // 4. Verify that receiving 'startupCommands' updates the UI
    // We'll check if it updates the global variable lastStartupCommands if it's accessible,
    // or if it updates some UI elements.
    // The handler for 'startupCommands' is:
    /*
    case 'startupCommands':
        lastStartupCommands = message.commands || {};
        const fields = {
            'role-cli-lead': lastStartupCommands.lead,
            'role-cli-coder': lastStartupCommands.coder,
            ...
        };
        Object.entries(fields).forEach(([id, val]) => {
            const el = document.getElementById(id);
            if (el) el.value = val || '';
        });
    */
    console.log('  -> Simulating receiving startupCommands');
    const testCommands = { lead: 'test-lead-cmd', coder: 'test-coder-cmd' };
    window.postMessage({ type: 'startupCommands', commands: testCommands }, '*');
    await new Promise(resolve => setTimeout(resolve, 50));

    const leadInput = window.document.getElementById('role-cli-lead');
    assert.strictEqual(leadInput.value, 'test-lead-cmd', 'Lead CLI input should be updated');

    console.log('\n✅ Onboarding regression test PASSED\n');
}

run().catch(err => {
    console.error('\n❌ Onboarding regression test FAILED:\n');
    console.error(err);
    process.exit(1);
});
