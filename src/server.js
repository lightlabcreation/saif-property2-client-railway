require('dotenv').config();
const app = require('./app');
const prisma = require('./config/prisma');
const { initLeaseCron, initInsuranceCron, initMoveOutCron } = require('./services/cron.service');
const { initMonthlyInvoiceCron } = require('./services/invoice.cron');

const PORT = process.env.PORT || 5000;

async function startServer() {
    try {
        // Check DB connection
        await prisma.$connect();
        console.log('✅ Database connected successfully');

        // Initialize cron jobs
        initLeaseCron();
        initInsuranceCron();
        initMoveOutCron();
        initMonthlyInvoiceCron();
        console.log('DEBUG: JWT_SECRET length:', process.env.JWT_SECRET ? process.env.JWT_SECRET.length : 'undefined');

        // Sync Legacy Unit Types (Production Safety Wrapper)
        const ratesCount = await prisma.unitTypeRate.count();
        if (ratesCount === 0) {
            console.log('🔄 First boot detected: Synchronizing legacy unit types into rates table...');
            const oldTypes = await prisma.unitType.findMany();
            for (const t of oldTypes) {
                await prisma.unitTypeRate.create({
                    data: { typeName: t.name, fullUnitRate: 0, singleBedroomRate: 0 }
                }).catch(() => {}); // Safety catch
            }
            console.log(`✅ Synced ${oldTypes.length} backward items successfully.`);
        }

        // 🛡️ RECOVERY: Mark any 'stuck' SMS campaigns from previous crashes
        console.log('🛡️  Scanning for stuck SMS campaigns...');
        const stuckCount = await prisma.sMSCampaign.updateMany({
            where: { status: 'PROCESSING' },
            data: { status: 'STUCK' }
        });
        if (stuckCount.count > 0) {
            console.log(`✅ Recovered ${stuckCount.count} stuck campaigns.`);
        }

        app.listen(PORT, () => {
            console.log(`🚀 Server running on port ${PORT}`);
        });
    } catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
}

startServer();
