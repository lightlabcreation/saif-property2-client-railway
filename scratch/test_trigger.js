const axios = require('axios');

async function testTrigger() {
    try {
        console.log('Testing trigger move-out...');
        // We can't easily call the API because it requires authentication.
        // I'll call the service directly via a script.
        const { initMoveOutWorkflow } = require('../src/services/workflow.service');
        const prisma = require('../src/config/prisma');

        const activeLease = await prisma.lease.findFirst({
            where: { status: 'Active' },
            orderBy: { createdAt: 'desc' }
        });

        if (!activeLease) {
            console.log('No active lease found.');
            return;
        }

        console.log(`Triggering move-out for lease ${activeLease.id}...`);
        const result = await initMoveOutWorkflow(activeLease.id);
        console.log('Success:', result);

    } catch (error) {
        console.error('Trigger failed:', error.message);
    }
}

testTrigger();
