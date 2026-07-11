const prisma = require('../../config/prisma');
const workflowService = require('../../services/workflow.service');
const { generateDashboardPDF } = require('../../utils/pdf.utils');

/**
 * Workflow Controller
 * Manages Move-In/Out Dashboards and Overrides
 */

const getMoveOutDashboard = async (req, res) => {
    try {
        const today = new Date();
        const thirtyDaysFromNow = new Date();
        thirtyDaysFromNow.setDate(today.getDate() + 30);
        const fourteenDaysAgo = new Date();
        fourteenDaysAgo.setDate(today.getDate() - 14);

        // 1. AUTO-TRIGGER: Find active leases expiring within 30 days (or expired in last 14 days) that don't have a Move-Out record yet
        const expiringLeases = await prisma.lease.findMany({
            where: {
                status: 'Active',
                endDate: {
                    lte: thirtyDaysFromNow,
                    gte: fourteenDaysAgo
                },
                moveOut: null // Only if not already in move-out flow
            }
        });

        // Initialize workflow for each newly discovered expiring lease
        for (const lease of expiringLeases) {
            await workflowService.initMoveOutWorkflow(lease.id);
        }

        // 2. FETCH: Get all move-outs and filter by the 30-day rule (Rule 2.1)
        let moveOuts;
        try {
            moveOuts = await prisma.moveOut.findMany({
                where: {
                    targetDate: {
                        lte: thirtyDaysFromNow
                        // We allow overdue ones (less than today) to stay visible
                    },
                    status: { not: 'CANCELLED' }
                },
                include: {
                    unit: { 
                        include: { 
                            property: true,
                            inspections: {
                                include: { template: true },
                                orderBy: { createdAt: 'desc' },
                                take: 10 // Get enough history to find matches
                            }
                        } 
                    },
                    lease: { include: { tenant: true } },
                    manager: { select: { id: true, name: true } }
                },
                orderBy: { targetDate: 'asc' }
            });
        } catch (fetchError) {
            console.error('MOVE_OUT_FETCH_ERROR: Likely invalid enum value. Attempting auto-repair...', fetchError.message);
            
            // AUTO-REPAIR: Force all empty or invalid statuses to PENDING
            await prisma.$executeRaw`UPDATE moveout SET status = 'PENDING' WHERE status = '' OR status IS NULL`;
            
            // Retry the fetch once
            moveOuts = await prisma.moveOut.findMany({
                where: {
                    targetDate: { lte: thirtyDaysFromNow },
                    status: { not: 'CANCELLED' }
                },
                include: {
                    unit: { include: { property: true } },
                    lease: { include: { tenant: true } },
                    manager: { select: { id: true, name: true } }
                },
                orderBy: { targetDate: 'asc' }
            });
        }

        // 3. AUTO-REPAIR: Link orphan inspections to Move-Out records to ensure green tags
        for (const mo of moveOuts) {
            let updated = false;
            let visualId = mo.visualInspectionId;
            let finalId = mo.finalInspectionId;

            // Look for matching inspections in the unit's inspection list
            const unitInspections = mo.unit?.inspections || [];
            
            // Check for Visual
            if (!visualId) {
                const visual = unitInspections.find(i => i.template?.type === 'VISUAL' && i.status !== 'CANCELLED');
                if (visual) {
                    visualId = visual.id;
                    updated = true;
                }
            }

            // Check for Move-Out
            if (!finalId) {
                const moveOut = unitInspections.find(i => i.template?.type === 'MOVE_OUT' && i.status !== 'CANCELLED');
                if (moveOut) {
                    finalId = moveOut.id;
                    updated = true;
                }
            }

            if (updated) {
                await prisma.$executeRawUnsafe(`UPDATE moveout SET visualInspectionId = ${visualId || 'NULL'}, finalInspectionId = ${finalId || 'NULL'} WHERE id = ${mo.id}`);
                // Update local object so stats/UI reflect the fix immediately
                mo.visualInspectionId = visualId;
                mo.finalInspectionId = finalId;
            }
        }

        // Compute urgency and days remaining
        const data = moveOuts.map(mo => {
            const target = workflowService.normalizeToNoon(mo.targetDate);
            const diffDays = Math.ceil((target - today) / (1000 * 60 * 60 * 24));
            return {
                ...mo,
                daysRemaining: diffDays,
                urgency: diffDays < 0 ? 'OVERDUE' : diffDays <= 7 ? 'HIGH' : 'NORMAL',
                inspections: mo.unit?.inspections || [] // Map unit inspections to move-out item for frontend
            };
        });

        res.json({ success: true, data });
    } catch (error) {
        console.error('MOVE_OUT_DASHBOARD_ERROR:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

const getMoveInDashboard = async (req, res) => {
    try {
        const moveIns = await prisma.moveIn.findMany({
            where: {
                status: { not: 'CANCELLED' },
                OR: [
                    { leaseId: { not: null } },
                    { unit: { reserved_by_id: { not: null } } }
                ]
            },
            include: {
                unit: { 
                    include: { 
                        reserved_by_user: true,
                        Ticket: {
                            where: {
                                status: 'Open',
                                isRequired: true
                            }
                        }
                    } 
                },
                lease: { 
                    include: { 
                        tenant: true,
                        insurances: { orderBy: { createdAt: 'desc' }, take: 1 },
                        invoices: { 
                            where: { 
                                category: { in: ['SECURITY_DEPOSIT', 'RENT'] } 
                            } 
                        } 
                    } 
                },
                overrideUser: { select: { id: true, name: true } }
            },
            orderBy: { targetDate: 'asc' }
        });

        // 0. Fetch all recent move-in inspections for these units to avoid N+1
        const unitIds = [...new Set(moveIns.map(mi => mi.unitId))];
        const allInspections = await prisma.inspection.findMany({
            where: {
                unitId: { in: unitIds },
                template: { type: 'MOVE_IN' }
            },
            orderBy: { createdAt: 'desc' }
        });

        // Add blocking status logic
        const data = moveIns.map(mi => {
            const today = new Date();
            const target = workflowService.normalizeToNoon(mi.targetDate);
            const diffDays = Math.ceil((target - today) / (1000 * 60 * 60 * 24));
            
            // 1. DB Checks: Check if Rent and Deposit are paid in the system
            const dbInsurance = mi.lease?.insurances?.some(i => i.status === 'ACTIVE') || false;
            
            // IMPROVED DEPOSIT CHECK: Check category 'SECURITY_DEPOSIT' OR any paid invoice with 'deposit' in description/category
            const dbDeposit = mi.lease?.invoices?.some(inv => 
                (inv.category === 'SECURITY_DEPOSIT' || inv.category === 'SERVICE' || inv.description?.toLowerCase().includes('deposit')) && 
                inv.status === 'paid' && 
                inv.amount >= (mi.lease.securityDeposit || 0)
            ) || false;

            const dbRent = mi.lease?.invoices?.filter(inv => inv.category === 'RENT').some(inv => inv.status === 'paid');
            
            // 2. Requirements from JSON field (Manual Overrides)
            const missingItems = Array.isArray(mi.missingItems) ? mi.missingItems : ['Rent', 'Deposit', 'Insurance'];
            
            // 3. Final logic: True if manually checked OR if record exists in DB
            const rentPaid = !missingItems.includes('Rent') || dbRent;
            
            // SPECIAL DEPOSIT LOGIC: Only mark as NOT_REQUIRED if lease EXISTS and is $0
            let depositStatus = 'MISSING';
            if (mi.lease) {
                const requiredDeposit = Number(mi.lease.securityDeposit || 0);
                if (requiredDeposit <= 0) {
                    depositStatus = 'NOT_REQUIRED';
                } else if (!missingItems.includes('Deposit') || dbDeposit) {
                    depositStatus = 'PAID';
                }
            } else {
                // No lease yet, stay MISSING
                depositStatus = 'MISSING';
            }

            const insuranceProvided = !missingItems.includes('Insurance') || dbInsurance;
            
            const hasBlockingTickets = (mi.unit?.Ticket?.length || 0) > 0;
            let currentStatus = mi.status;

            const isLeaseSigned = mi.leaseId != null && mi.lease?.status !== 'Pending';

            // Transition: Blocked -> Missing Requirements
            // LEASE GATEKEEPER RULE: If lease is not signed, it stays in Upcoming (PENDING)
            if (!isLeaseSigned) {
                currentStatus = 'PENDING';
            } 
            // MODULE 3/4 RULE: If there are blocking tickets, it STAYS in BLOCKED_IN_PREPARATION
            else if (hasBlockingTickets) {
                currentStatus = 'BLOCKED_IN_PREPARATION';
            } else if (currentStatus === 'PENDING' || currentStatus === 'BLOCKED_IN_PREPARATION' || currentStatus === 'BLOCKED_IN_CONSTRUCTION') {
                if (mi.unit?.unit_status === 'ACTIVE' || mi.unit?.ready_for_leasing || mi.unit?.unit_ready_completed) {
                    currentStatus = 'REQUIREMENTS_PENDING';
                }
            }

            const inspection = allInspections.find(ins => ins.unitId === mi.unitId && ins.leaseId === mi.leaseId);
            const hasDraftInspection = inspection && inspection.status === 'DRAFT';
            const hasCompletedInspection = inspection && inspection.status === 'COMPLETED';

            // Transition: Missing Requirements <-> Ready for Move-In
            if (currentStatus === 'REQUIREMENTS_PENDING' || currentStatus === 'READY_FOR_MOVE_IN') {
                const isDepositOk = depositStatus === 'PAID' || depositStatus === 'NOT_REQUIRED';
                const reqsMet = rentPaid && isDepositOk && insuranceProvided;
                if (reqsMet || mi.overrideFlag) {
                    currentStatus = 'READY_FOR_MOVE_IN';
                } else {
                    currentStatus = 'REQUIREMENTS_PENDING';
                }
            }

            // Transition: Inspection Logic
            if (currentStatus !== 'OCCUPIED') {
                if (hasCompletedInspection) {
                    currentStatus = 'INSPECTION_COMPLETED';
                } else if (hasDraftInspection) {
                    currentStatus = 'INSPECTION_IN_PROGRESS';
                }
            }

            return {
                ...mi,
                status: currentStatus,
                daysRemaining: diffDays,
                inspectionId: inspection?.id || null,
                urgency: diffDays < 0 ? 'OVERDUE' : diffDays <= 7 ? 'HIGH' : 'NORMAL',
                requirements: {
                    rent: rentPaid,
                    deposit: depositStatus, // Now returns 'MISSING', 'PAID', or 'NOT_REQUIRED'
                    insurance: insuranceProvided,
                    repairs: !hasBlockingTickets
                }
            };
        });

        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const approveMoveOut = async (req, res) => {
    try {
        const { id } = req.params;
        const managerId = req.user.id;

        const moveOut = await prisma.moveOut.update({
            where: { id: parseInt(id) },
            data: {
                status: 'COMPLETED',
                managerApproved: true,
                managerId: managerId,
                actualDate: new Date()
            }
        });

        // Trigger transition to Unit Prep
        await workflowService.updateUnitPrepStage(moveOut.unitId, {
            stage: 'PENDING_TICKETS',
            userId: managerId
        });

        res.json({ success: true, data: moveOut });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const overrideMoveIn = async (req, res) => {
    try {
        const { id } = req.params;
        const { reason, missingItems } = req.body;
        const userId = req.user.id;

        const result = await workflowService.overrideMoveIn(parseInt(id), userId, {
            reason,
            missingItems
        });

        res.json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const getUnitHistory = async (req, res) => {
    try {
        const { unitId } = req.params;
        const history = await prisma.unitHistory.findMany({
            where: { unitId: parseInt(unitId) },
            include: { user: { select: { name: true, role: true } } },
            orderBy: { timestamp: 'desc' }
        });
        res.json({ success: true, data: history });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const approveMoveIn = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;

        const result = await workflowService.completeMoveIn(parseInt(id), userId);
        res.json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const confirmMoveOut = async (req, res) => {
    try {
        const { id } = req.params;
        const { visualDate, visualTime } = req.body;
        
        const existing = await prisma.moveOut.findUnique({ where: { id: parseInt(id) } });
        
        const moveOut = await prisma.moveOut.update({
            where: { id: parseInt(id) },
            data: { 
                status: (visualDate || existing.finalDate) ? 'VISUAL_INSPECTION_SCHEDULED' : 'CONFIRMED',
                visualDate: visualDate ? workflowService.normalizeToNoon(visualDate) : null,
                visualTime: visualTime || null
            }
        });
        res.json({ success: true, data: moveOut });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const scheduleFinalInspection = async (req, res) => {
    try {
        const { id } = req.params;
        const { finalDate, finalTime } = req.body;
        
        const existing = await prisma.moveOut.findUnique({ where: { id: parseInt(id) } });

        const moveOut = await prisma.moveOut.update({
            where: { id: parseInt(id) },
            data: { 
                status: (finalDate || existing.visualDate) ? 'VISUAL_INSPECTION_SCHEDULED' : 'CONFIRMED',
                finalDate: finalDate ? workflowService.normalizeToNoon(finalDate) : null,
                finalTime: finalTime || null
            }
        });
        res.json({ success: true, data: moveOut });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const completeMoveOut = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;

        // Rule 2.4: Mandatory Inspection Rule
        const moveOut = await prisma.moveOut.findUnique({
            where: { id: parseInt(id) },
            include: { unit: true }
        });

        if (!moveOut.visualInspectionId || !moveOut.finalInspectionId) {
            // Note: During testing, we might want to allow override, 
            // but the rule says "System must block progression"
            return res.status(400).json({ 
                success: false, 
                message: "BLOCK: Both Visual and Move-Out inspections must be completed before finishing the flow." 
            });
        }

        // Uses the correct flow that enforces Mandatory Inspection Rule and creates Prep Tasks
        await workflowService.completeMoveOutFlow(parseInt(id), userId);

        res.json({ success: true, message: 'Move-Out flow completed successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const getUnitPrepDashboard = async (req, res) => {
    try {
        // Fetch units that are in preparation (usually marked as Vacant after move-out or newly construction)
        const units = await prisma.unit.findMany({
            where: {
                OR: [
                    {
                        current_stage: {
                            in: ['PENDING_TICKETS', 'READY_FOR_CLEANING', 'CLEANING_IN_PROGRESS', 'CLEANING_COMPLETED', 'UNIT_READY']
                        }
                    },
                    {
                        Ticket: {
                            some: {
                                status: 'Open',
                                isRequired: true
                            }
                        }
                    }
                ]
            },
            include: {
                property: true,
                leases: {
                    where: { status: { in: ['Active', 'Scheduled'] } },
                    include: { tenant: true }
                },
                moveOuts: {
                    orderBy: { createdAt: 'desc' },
                    take: 1,
                    include: { lease: { include: { tenant: true } } }
                },
                reserved_by_user: true
            }
        });

        // Filter out units that have an active, incomplete Move-Out record
        const prepUnitsOnly = units.filter(unit => {
            const latestMoveOut = unit.moveOuts?.[0];
            if (latestMoveOut && latestMoveOut.status !== 'COMPLETED' && latestMoveOut.status !== 'CANCELLED') {
                return false;
            }
            return true;
        });

        // For each unit, check if it's blocked by required tickets
        const dashboardData = await Promise.all(prepUnitsOnly.map(async (unit) => {
            const openTickets = await prisma.ticket.findMany({
                where: { unitId: unit.id, status: 'Open' }
            });

            const requiredTickets = openTickets.filter(t => t.isRequired);
            const hasRequiredTickets = requiredTickets.length > 0;

            let effectiveStage = unit.current_stage;
            // If it's in PENDING_TICKETS but has no required repairs, it's effectively READY_FOR_CLEANING
            if (effectiveStage === 'PENDING_TICKETS' && !hasRequiredTickets) {
                effectiveStage = 'READY_FOR_CLEANING';
            }

            return {
                ...unit,
                hasRequiredTickets,
                requiredTicketsCount: requiredTickets.length,
                totalOpenTickets: openTickets.length,
                current_stage: effectiveStage
            };
        }));

        // Dynamic Stats Calculation
        const stats = {
            upcomingMoveOuts: await prisma.moveOut.count({ where: { status: 'PENDING' } }),
            confirmedMoveOuts: await prisma.moveOut.count({ where: { status: 'CONFIRMED' } }),
            inspectionsScheduled: await prisma.inspection.count({ where: { status: 'DRAFT' } }),
            inRepair: dashboardData.filter(d => d.hasRequiredTickets).length,
            cleaningTotal: dashboardData.filter(d => d.current_stage === 'READY_FOR_CLEANING' || d.current_stage === 'CLEANING_IN_PROGRESS').length,
            readyForCompletion: dashboardData.filter(d => d.current_stage === 'CLEANING_COMPLETED').length,
            // Count all units ever marked as Unit Ready (unit_ready_completed=true) for the stat card
            unitsReady: await prisma.unit.count({ where: { unit_ready_completed: true } })
        };

        res.json({ success: true, data: dashboardData, stats });
    } catch (error) {
        console.error('UNIT_PREP_ERROR:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

const updateUnitPrepStage = async (req, res) => {
    try {
        const { unitId } = req.params;
        const { nextStage } = req.body;

        const unit = await prisma.unit.findUnique({
            where: { id: parseInt(unitId) }
        });

        if (!unit) return res.status(404).json({ success: false, message: 'Unit not found' });

        // Blocking Logic (3.5 & 3.8): Cleaning only starts AFTER required tickets completed
        if (nextStage === 'CLEANING_IN_PROGRESS' || nextStage === 'READY_FOR_CLEANING') {
            const requiredTickets = await prisma.ticket.findMany({
                where: {
                    unitId: parseInt(unitId),
                    status: 'Open',
                    isRequired: true
                }
            });

            if (requiredTickets.length > 0) {
                return res.status(400).json({ 
                    success: false, 
                    message: `Blocked: ${requiredTickets.length} required tickets must be completed first.` 
                });
            }
        }

        // Final State Logic (3.9)
        const updateData = { current_stage: nextStage };
        if (nextStage === 'UNIT_READY') {
            updateData.current_stage = 'UNIT_READY';
            updateData.availability_status = 'Available';
            updateData.ready_for_leasing = true;
            updateData.unit_ready_completed = true;
            updateData.unit_ready_completed_date = new Date();
            updateData.status_note = 'Ready for Move-In';
        } else if (nextStage === 'COMPLETE_PREP') {
            updateData.current_stage = null; // Clear from prep dashboard
        }

        const updatedUnit = await prisma.unit.update({
            where: { id: parseInt(unitId) },
            data: updateData
        });

        // Add history log
        await prisma.unitHistory.create({
            data: {
                unitId: parseInt(unitId),
                userId: req.user.id,
                action: `PREP_STAGE_CHANGED: ${nextStage}`,
                newStatus: nextStage === 'UNIT_READY' ? 'Available' : unit.availability_status
            }
        });

        res.json({ success: true, data: updatedUnit });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const overrideUnitPrepBlock = async (req, res) => {
    try {
        const { unitId } = req.params;
        const result = await workflowService.overrideUnitPrepBlock(parseInt(unitId), req.user.id);
        res.json({ success: true, message: 'Unit Prep Block overridden successfully', data: result });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const triggerMoveOut = async (req, res) => {
    try {
        let leaseIdToUse = parseInt(req.params.leaseId);
        
        // For testing purposes, if leaseId is 1 (dummy), find the first active lease
        if (leaseIdToUse === 1) {
            const activeLease = await prisma.lease.findFirst({
                where: { status: 'Active' },
                orderBy: { createdAt: 'desc' }
            });
            
            if (!activeLease) {
                return res.status(404).json({ success: false, message: 'No active lease found to trigger move-out.' });
            }
            leaseIdToUse = activeLease.id;
        }

        const result = await workflowService.initMoveOutWorkflow(leaseIdToUse);
        res.json({ success: true, message: 'Move-out flow triggered successfully', data: result });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const cancelMoveOut = async (req, res) => {
    try {
        const { leaseId } = req.params;
        await workflowService.cancelMoveOutFlow(parseInt(leaseId), req.user.id);
        res.json({ success: true, message: 'Move-Out cancelled successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const exportMoveInPDF = async (req, res) => {
    try {
        const moveIns = await prisma.moveIn.findMany({
            include: {
                unit: true,
                lease: { include: { tenant: true } }
            },
            orderBy: { targetDate: 'asc' }
        });
        generateDashboardPDF('Move-In Dashboard Report', moveIns, res);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const exportMoveOutPDF = async (req, res) => {
    try {
        const moveOuts = await prisma.moveOut.findMany({
            include: {
                unit: true,
                lease: { include: { tenant: true } }
            },
            orderBy: { targetDate: 'asc' }
        });
        generateDashboardPDF('Move-Out Dashboard Report', moveOuts, res);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const exportUnitPrepPDF = async (req, res) => {
    try {
        const units = await prisma.unit.findMany({
            where: {
                current_stage: {
                    in: ['PENDING_TICKETS', 'READY_FOR_CLEANING', 'CLEANING_IN_PROGRESS', 'CLEANING_COMPLETED', 'UNIT_READY']
                }
            },
            include: { 
                property: true,
                leases: {
                    where: { status: 'Active' },
                    include: { tenant: true }
                }
            }
        });
        
        const dataForPDF = units.map(u => ({
            unit: { name: u.unitNumber },
            lease: {
                tenant: {
                    name: u.leases?.[0]?.tenant?.name || 'Vacant'
                }
            },
            status: u.current_stage,
            createdAt: new Date()
        }));

        generateDashboardPDF('Unit Preparation Report', dataForPDF, res);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const toggleMoveInRequirement = async (req, res) => {
    try {
        const { moveInId } = req.params;
        const { requirement, completed } = req.body;
        const result = await workflowService.updateMoveInRequirement(parseInt(moveInId), { requirement, completed });
        res.json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const getInspectionUnits = async (req, res) => {
    try {
        const units = await prisma.unit.findMany({
            where: {
                propertyId: req.query.propertyId ? parseInt(req.query.propertyId) : undefined,
            },
            include: {
                leases: {
                    where: { status: { in: ['Active', 'RESERVED', 'Pending'] } },
                    include: { tenant: true },
                    orderBy: { createdAt: 'desc' }
                },
                reserved_by_user: true,
                property: true,
                moveIns: {
                    where: { status: { not: 'CANCELLED' } },
                    orderBy: { createdAt: 'desc' },
                    take: 1
                },
                moveOuts: {
                    where: { status: { not: 'CANCELLED' } },
                    orderBy: { createdAt: 'desc' },
                    take: 1
                }
            },
            orderBy: { name: 'asc' }
        });

        const data = units.map(u => {
            // Priority: Active Lease, then Reserved Lease
            const activeLease = u.leases.find(l => l.status === 'Active') || u.leases[0];
            const moveIn = u.moveIns[0];
            const moveOut = u.moveOuts[0];

            return {
                id: u.id,
                unitId: u.id,
                moveInId: moveIn?.id || null,
                moveOutId: moveOut?.id || null,
                unitNumber: u.unitNumber || u.name,
                leaseId: activeLease?.id || null,
                tenantName: activeLease?.tenant?.name || activeLease?.tenant?.firstName || u.reserved_by_user?.name || 'Vacant / Prospect',
                unit: {
                    unitNumber: u.unitNumber || u.name,
                    propertyId: u.propertyId,
                    property: u.property
                },
                lease: activeLease ? {
                    id: activeLease.id,
                    tenant: activeLease.tenant
                } : null
            };
        });

        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const cancelMoveIn = async (req, res) => {
    try {
        const { id } = req.params;
        const result = await prisma.moveIn.update({
            where: { id: parseInt(id) },
            data: { status: 'CANCELLED' }
        });
        res.json({ success: true, message: 'Move-in cancelled successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    getInspectionUnits,
    getMoveOutDashboard,
    getMoveInDashboard,
    exportMoveInPDF,
    exportMoveOutPDF,
    exportUnitPrepPDF,
    approveMoveOut,
    confirmMoveOut,
    completeMoveOut,
    triggerMoveOut,
    cancelMoveOut,
    cancelMoveIn,
    scheduleFinalInspection,
    overrideMoveIn,
    approveMoveIn,
    toggleMoveInRequirement,
    getUnitPrepDashboard,
    updateUnitPrepStage,
    overrideUnitPrepBlock,
    getUnitHistory
};
