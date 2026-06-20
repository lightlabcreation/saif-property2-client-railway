const axios = require('axios');

async function test() {
    try {
        // Since we don't hold the bearer token easy in Node runner, let me query Prisma directly!
        const { PrismaClient } = require('@prisma/client');
        const prisma = new PrismaClient();
        
        const tenants = await prisma.user.findMany({ where: { type: 'RESIDENT' } });
        console.log("Total Residents:", tenants.length);
        console.log("Tenants Data sample:", tenants.slice(0, 2).map(u => ({ email: u.email, name: u.name || `${u.firstName || ''} ${u.lastName || ''}`.trim() })));
        
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}
test();
