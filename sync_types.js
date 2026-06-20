const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
    try {
        const oldTypes = await prisma.unitType.findMany();
        console.log(`Found ${oldTypes.length} old types in DB.`);

        let inserted = 0;
        for (const t of oldTypes) {
            // Check if already exists in rate table to avoid duplicate P-Key collisions
            const existing = await prisma.unitTypeRate.findFirst({
                where: { typeName: t.name }
            });

            if (!existing) {
                await prisma.unitTypeRate.create({
                    data: {
                        typeName: t.name,
                        fullUnitRate: 0,
                        singleBedroomRate: 0
                    }
                });
                inserted++;
                console.log(`✅ Synced: ${t.name}`);
            }
        }
        console.log(`\n🎉 Total Synced: ${inserted} items.`);
        process.exit(0);
    } catch (e) {
        console.error("❌ Migration fail:", e);
        process.exit(1);
    }
}
run();
