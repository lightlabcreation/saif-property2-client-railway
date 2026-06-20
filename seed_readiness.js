const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function seed() {
    console.log("--- SEEDING UNIT READINESS TEST DATA ---");

    try {
        // 1. Get a property to attach units to
        const property = await prisma.property.findFirst();
        if (!property) {
            console.log("❌ Error: No property found in database. Please create a property first.");
            return;
        }

        const units = [
            { 
                name: 'Unit 101',
                unitNumber: 'TEST-101', 
                gc_delivered_completed: true, 
                gc_delivered_completed_date: new Date('2026-04-01'),
                gc_deficiencies_completed: false,
                gc_deficiencies_target_date: new Date('2026-04-05'),
                status_note: 'On Schedule',
                propertyId: property.id
            },
            { 
                name: 'Unit 102',
                unitNumber: 'TEST-102', 
                gc_delivered_completed: true, 
                gc_delivered_completed_date: new Date('2026-03-20'),
                gc_deficiencies_completed: true,
                gc_deficiencies_completed_date: new Date('2026-03-25'),
                gc_cleaned_completed: true,
                gc_cleaned_completed_date: new Date('2026-03-28'),
                ffe_installed_completed: false,
                ffe_installed_target_date: new Date('2026-04-10'),
                status_note: 'Action Required',
                propertyId: property.id
            },
            { 
                name: 'Unit 103',
                unitNumber: 'TEST-103', 
                gc_delivered_completed: true, 
                gc_delivered_completed_date: new Date('2026-03-15'),
                gc_deficiencies_completed: false,
                gc_deficiencies_target_date: new Date('2026-03-20'),
                ffe_installed_completed: true, 
                ffe_installed_completed_date: new Date('2026-04-05'),
                status_note: '⚠ Deficiencies open',
                propertyId: property.id
            },
            { 
                name: 'Unit 104',
                unitNumber: 'TEST-104', 
                gc_delivered_completed: true,
                gc_delivered_completed_date: new Date('2026-04-01'),
                gc_deficiencies_completed: true,
                gc_cleaned_completed: true,
                ffe_installed_completed: true,
                final_cleaning_completed: true,
                final_cleaning_completed_date: new Date('2026-04-08'),
                unit_ready_completed: true,
                unit_ready_completed_date: new Date('2026-04-08'),
                ready_for_leasing: true,
                unit_status: 'ACTIVE',
                availability_status: 'Available',
                propertyId: property.id
            },
            { 
                name: 'Unit 105',
                unitNumber: 'TEST-105', 
                gc_delivered_completed: true,
                gc_deficiencies_completed: true,
                gc_cleaned_completed: true,
                ffe_installed_completed: true,
                final_cleaning_completed: true,
                final_cleaning_completed_date: new Date('2026-03-01'),
                unit_ready_completed: true,
                ready_for_leasing: true,
                unit_status: 'ACTIVE',
                availability_status: 'Occupied',
                propertyId: property.id
            }
        ];

        for (const u of units) {
            const existing = await prisma.unit.findFirst({
                where: { unitNumber: u.unitNumber, propertyId: property.id }
            });

            if (existing) {
                await prisma.unit.update({
                    where: { id: existing.id },
                    data: u
                });
                console.log(`Unit updated: ${u.unitNumber}`);
            } else {
                await prisma.unit.create({
                    data: u
                });
                console.log(`Unit created: ${u.unitNumber}`);
            }
        }

        console.log("✅ SUCCESS: 5 test units seeded.");
    } catch (error) {
        console.error("❌ Seed Error:", error);
    } finally {
        await prisma.$disconnect();
    }
}

seed();
