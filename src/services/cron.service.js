const cron = require('node-cron');
const prisma = require('../config/prisma');
const { checkInsuranceExpirations } = require('../modules/admin/insurance.controller');
const { initMoveOutWorkflow } = require('./workflow.service');

/**
 * Lease Expiry Cron Job
 * Runs once per day at midnight (or configured CRON_TIME)
 * Finds active leases that have passed their end date
 * Updates lease status to 'Expired'
 * Updates unit status to 'Vacant'
 */
const initLeaseCron = () => {
    const cronTime = process.env.CRON_TIME || '0 0 * * *';

    console.log(`[Cron] Initializing Lease Expiry cron with schedule: ${cronTime}`);

    cron.schedule(cronTime, async () => {
        console.log('[Cron] Running daily lease expiry check...');
        const timeZone = process.env.TZ || 'Asia/Kolkata';
        const today = new Date(new Date().toLocaleString("en-US", { timeZone }));
        today.setHours(0, 0, 0, 0);

        try {
            // Transaction for consistency
            const result = await prisma.$transaction(async (tx) => {
                // 1. Find all active leases that have ended
                const expiredLeases = await tx.lease.findMany({
                    where: {
                        status: 'Active',
                        endDate: {
                            lt: today
                        }
                    },
                    include: {
                        unit: true
                    }
                });

                if (expiredLeases.length === 0) {
                    return { processed: 0, failed: 0 };
                }

                let processedCount = 0;
                let failedCount = 0;

                for (const lease of expiredLeases) {
                    try {
                        // 2. Update lease status to Expired
                        await tx.lease.update({
                            where: { id: lease.id },
                            data: { status: 'Expired' }
                        });

                        // 3. Reset tenant and residents
                        // Clear assignments for all residents tied to this specific lease
                        await tx.user.updateMany({
                            where: { leaseId: lease.id, type: 'RESIDENT' },
                            data: { leaseId: null, bedroomId: null, unitId: null, buildingId: null }
                        });

                        // For the primary tenant, only clear if they don't have OTHER active leases
                        const tenantOtherLeases = await tx.lease.findFirst({
                            where: { 
                                tenantId: lease.tenantId, 
                                status: 'Active', 
                                NOT: { id: lease.id } 
                            }
                        });

                        if (!tenantOtherLeases) {
                            await tx.user.update({
                                where: { id: lease.tenantId },
                                data: { bedroomId: null, unitId: null, buildingId: null }
                            });
                        }

                        // 4. Update unit and bedroom status
                        const isFullUnitLease = !lease.bedroomId;

                        const otherActiveLeases = await tx.lease.findMany({
                            where: {
                                unitId: lease.unitId,
                                status: { in: ['Active', 'DRAFT'] },
                                NOT: { id: lease.id }
                            }
                        });

                        if (isFullUnitLease) {
                            if (lease.unit.status !== 'Under Maintenance' && otherActiveLeases.length === 0) {
                                await tx.unit.update({
                                    where: { id: lease.unitId },
                                    data: { status: 'Vacant' }
                                });
                                await tx.bedroom.updateMany({
                                    where: { unitId: lease.unitId },
                                    data: { status: 'Vacant' }
                                });
                            }
                        } else {
                            // Bedroom lease
                            await tx.bedroom.update({
                                where: { id: lease.bedroomId },
                                data: { status: 'Vacant' }
                            });

                            if (lease.unit.status !== 'Under Maintenance') {
                                const unitBedrooms = await tx.bedroom.findMany({
                                    where: { unitId: lease.unitId }
                                });
                                const allVacant = unitBedrooms.length > 0 && unitBedrooms.every(b => b.status === 'Vacant');
                                const anyOccupied = unitBedrooms.some(b => b.status === 'Occupied');

                                if (allVacant && otherActiveLeases.length === 0) {
                                    await tx.unit.update({
                                        where: { id: lease.unitId },
                                        data: { status: 'Vacant' }
                                    });
                                } else if (anyOccupied) {
                                    await tx.unit.update({
                                        where: { id: lease.unitId },
                                        data: { status: 'Occupied' }
                                    });
                                } else if (otherActiveLeases.length === 0) {
                                    await tx.unit.update({
                                        where: { id: lease.unitId },
                                        data: { status: 'Vacant' }
                                    });
                                }
                            }
                        }

                        processedCount++;
                    } catch (err) {
                        console.error(`[Cron] Error processing lease ${lease.id}:`, err);
                        failedCount++;
                    }
                }

                return { processed: processedCount, failed: failedCount };
            });

            console.log(`[Cron] Lease expiry check completed. Summary: Processed: ${result.processed}, Failed: ${result.failed}`);
        } catch (error) {
            console.error('[Cron] Fatal error in lease expiry cron job:', error);
        }
    });
};

/**
 * Insurance Expiration Cron Job
 * Runs once per day at 1:00 AM
 */
const initInsuranceCron = () => {
    const insuranceCronTime = process.env.INSURANCE_CRON_TIME || '0 1 * * *';

    console.log(`[Cron] Initializing Insurance Expiration cron with schedule: ${insuranceCronTime}`);

    cron.schedule(insuranceCronTime, async () => {
        try {
            await checkInsuranceExpirations();
        } catch (error) {
            console.error('[Cron] Error in insurance expiration cron job:', error);
        }
    });
};

/**
 * Move-Out Auto-Trigger Cron Job
 * Runs once per day at 2:00 AM
 * Finds leases ending in exactly 30 days
 */
const initMoveOutCron = () => {
    const moveOutCronTime = process.env.MOVEOUT_CRON_TIME || '0 2 * * *';

    console.log(`[Cron] Initializing Move-Out Auto-Trigger cron with schedule: ${moveOutCronTime}`);

    cron.schedule(moveOutCronTime, async () => {
        console.log('[Cron] Running daily Move-Out auto-trigger check...');
        
        const targetDate = new Date();
        targetDate.setDate(targetDate.getDate() + 30);
        targetDate.setHours(0, 0, 0, 0);

        try {
            const leasesEndingSoon = await prisma.lease.findMany({
                where: {
                    status: 'Active',
                    endDate: {
                        gte: targetDate,
                        lt: new Date(targetDate.getTime() + 24 * 60 * 60 * 1000)
                    }
                }
            });

            console.log(`[Cron] Found ${leasesEndingSoon.length} leases ending in 30 days.`);

            for (const lease of leasesEndingSoon) {
                try {
                    await initMoveOutWorkflow(lease.id);
                } catch (err) {
                    console.error(`[Cron] Error initializing move-out for lease ${lease.id}:`, err);
                }
            }
        } catch (error) {
            console.error('[Cron] Error in Move-Out auto-trigger cron job:', error);
        }
    });
};

module.exports = { initLeaseCron, initInsuranceCron, initMoveOutCron };
