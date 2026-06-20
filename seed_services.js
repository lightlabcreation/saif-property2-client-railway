const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
    try {
        console.log("Checking ServiceFeeItem table...");
        const count = await prisma.serviceFeeItem.count();
        console.log(`Table exists! Current row count: ${count}`);

        if (count === 0) {
            console.log("Seeding default service items...");
            const items = [
                { name: "Cleaning fee", amount: 150 },
                { name: "Wall repair", amount: 200 },
                { name: "Paint touch-up", amount: 120 },
                { name: "Appliance damage", amount: 300 },
                { name: "Missing keys", amount: 50 },
                { name: "Missing FOB", amount: 75 },
                { name: "Garbage removal", amount: 90 },
                { name: "Furniture removal", amount: 150 },
                { name: "Other repair charges", amount: 0 }
            ];

            await prisma.serviceFeeItem.createMany({
                data: items
            });
            console.log("Seed complete for Service Fee Items!");
        }

    } catch (e) {
        console.error("Error:", e.message);
    } finally {
        await prisma.$disconnect();
    }
}

run();
