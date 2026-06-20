const prisma = require('../config/prisma');
const AppError = require('../utils/AppError');

/**
 * Normalizes a date to 12:00 PM (Noon) UTC to prevent timezone shifting
 */
const normalizeToNoon = (date) => {
    if (!date) return null;
    const d = new Date(date);
    d.setUTCHours(12, 0, 0, 0);
    return d;
};

/**
 * Workflow Service
 * Handles business logic for Move-In, Move-Out, and Unit Preparation
 * All critical operations use Prisma Transactions for data integrity.
 */

/**
 * Initialize Move-Out Workflow
 * Triggered 30 days before lease end or manually by Admin
 */
const initMoveOutWorkflow = async (leaseId, tx = prisma) => {
    const logic = async (pTx) => {
        const lease = await pTx.lease.findUnique({
            where: { id: leaseId },
            include: { unit: true }
        });

        if (!lease) throw new Error('Lease not found');

        // Check if move-out already exists
        const existingMoveOut = await pTx.moveOut.findUnique({
            where: { leaseId }
        });

        if (existingMoveOut) return existingMoveOut;

        // Create MoveOut record
        const moveOut = await pTx.moveOut.create({
            data: {
                leaseId: lease.id,
                unitId: lease.unitId,
                bedroomId: lease.bedroomId,
                status: 'PENDING',
                targetDate: lease.endDate
            }
        });

        // Log to Unit History
        await pTx.unitHistory.create({
            data: {
                unitId: lease.unitId,
                bedroomId: lease.bedroomId,
                userId: lease.tenantId, // Initial trigger related to tenant
                action: 'MOVE_OUT_INITIATED',
                newStatus: 'PENDING',
                timestamp: new Date()
            }
        });

        return moveOut;
    };

    if (tx === prisma) {
        return await prisma.$transaction(logic, { timeout: 15000 });
    } else {
        return await logic(tx);
    }
};

/**
 * Complete Inspection & Generate Deficiency Tasks
 */
const completeInspection = async (inspectionId, { signature, inspectorSignature, noDeficiencyConfirmed, ticketCategory = 'MAINTENANCE' }) => {
    return await prisma.$transaction(async (tx) => {
        const inspection = await tx.inspection.findUnique({
            where: { id: inspectionId },
            include: { 
                responses: { include: { media: true } },
                template: true
            }
        });

        if (!inspection) throw new Error('Inspection not found');
        if (inspection.status === 'COMPLETED') throw new Error('Inspection already completed');

        // 1. Update Inspection Record
        const updatedInspection = await tx.inspection.update({
            where: { id: inspectionId },
            data: {
                status: 'COMPLETED',
                tenantSignature: signature,
                inspectorSignature: inspectorSignature,
                noDeficiencyConfirmed,
                completedAt: new Date()
            }
        });

        // 2. Workflow Transitions
        const { type } = inspection.template;
        
        if (type === 'MOVE_OUT' || type === 'VISUAL') {
            // Find active MoveOut record
            const moveOut = await tx.moveOut.findFirst({
                where: { 
                    unitId: inspection.unitId,
                    status: { notIn: ['COMPLETED', 'CANCELLED'] }
                }
            });

            if (moveOut) {
                // Check if both types are now completed for this move-out
                const relatedInspections = await tx.inspection.findMany({
                    where: {
                        unitId: inspection.unitId,
                        leaseId: inspection.leaseId,
                        status: 'COMPLETED',
                        template: { type: { in: ['MOVE_OUT', 'VISUAL'] } }
                    },
                    include: { template: true }
                });

                const hasVisual = relatedInspections.some(i => i.template.type === 'VISUAL');
                const hasMoveOut = relatedInspections.some(i => i.template.type === 'MOVE_OUT');

                if (hasVisual && hasMoveOut) {
                    await tx.moveOut.update({
                        where: { id: moveOut.id },
                        data: { status: 'INSPECTIONS_COMPLETED' }
                    });
                } else if (type === 'VISUAL') {
                    await tx.moveOut.update({
                        where: { id: moveOut.id },
                        data: { status: 'VISUAL_INSPECTION_SCHEDULED' } // Or add a 'COMPLETED' sub-status if needed
                    });
                }
            }
        } else if (type === 'MOVE_IN') {
            // Find the active MoveIn record for this unit/lease
            const moveIn = await tx.moveIn.findFirst({
                where: { 
                    unitId: updatedInspection.unitId,
                    leaseId: updatedInspection.leaseId || null,
                    status: { notIn: ['INSPECTION_COMPLETED', 'OCCUPIED', 'CANCELLED'] }
                }
            });

            if (moveIn) {
                await tx.moveIn.update({
                    where: { id: moveIn.id },
                    data: { 
                        status: 'INSPECTION_COMPLETED',
                        actualDate: new Date()
                    }
                });
            }
        }

        // 3. AUTO-TICKET: Generate maintenance tickets for any damages found (Phase 4)
        await createTicketsFromInspection(inspectionId, updatedInspection.inspectorId, tx);

        return updatedInspection;
    });
};

/**
 * Admin Override for Move-In
 */
const overrideMoveIn = async (moveInId, userId, { reason, missingItems }) => {
    return await prisma.$transaction(async (tx) => {
        const moveIn = await tx.moveIn.findUnique({
            where: { id: moveInId },
            include: { unit: true }
        });

        if (!moveIn) throw new Error('Move-In record not found');

        // Ensure missingItems is an array
        let itemsArray = [];
        if (Array.isArray(missingItems)) {
            itemsArray = missingItems;
        } else if (typeof missingItems === 'string' && missingItems.trim() !== '') {
            itemsArray = missingItems.split(',').map(i => i.trim());
        }

        // Determine who the follow-up tickets should be associated with
        let ticketTargetUserId = userId;
        if (moveIn.leaseId) {
            const lease = await tx.lease.findUnique({ where: { id: moveIn.leaseId } });
            if (lease?.tenantId) ticketTargetUserId = lease.tenantId;
        } else if (moveIn.unit?.reserved_by_id) {
            ticketTargetUserId = moveIn.unit.reserved_by_id;
        }

        // 1. Log Override (Module 4, Rule 5)
        const updatedMoveIn = await tx.moveIn.update({
            where: { id: moveInId },
            data: {
                overrideFlag: true,
                overrideReason: reason,
                overrideByUserId: userId,
                overrideAt: new Date(),
                missingItems: itemsArray,
                status: 'READY_FOR_MOVE_IN'
            }
        });

        // 2. Create Follow-up Tasks for missing items (Module 4, Rule 5)
        for (const item of itemsArray) {
            await tx.ticket.create({
                data: {
                    userId: ticketTargetUserId,
                    subject: `OVERRIDE FOLLOW-UP: ${item}`,
                    description: `Missing requirement at move-in. Reason: ${reason}`,
                    priority: 'High',
                    category: 'ADMIN',
                    source: 'MOVE_IN_OVERRIDE',
                    propertyId: moveIn.unit.propertyId,
                    unitId: moveIn.unitId,
                    isRequired: false // Overridden items are usually follow-up, not blocking anymore
                }
            });
        }

        // 3. Log to Unit History (Module 4, Rule 5)
        await tx.unitHistory.create({
            data: {
                unitId: moveIn.unitId,
                bedroomId: moveIn.bedroomId,
                userId: userId,
                action: 'MOVE_IN_OVERRIDE',
                newStatus: `Reason: ${reason} | Missing: ${itemsArray.join(', ')}`,
                timestamp: new Date()
            }
        });

        // Also update unit status if necessary
        await tx.unit.update({
            where: { id: moveIn.unitId },
            data: { status_note: 'Unblocked - Move-In Overridden' }
        });

        return updatedMoveIn;
    });
};

/**
 * Update Unit Preparation Stage
 */
const updateUnitPrepStage = async (unitId, { stage, userId }) => {
    return await prisma.$transaction(async (tx) => {
        const unit = await tx.unit.findUnique({ where: { id: unitId } });

        // Update stage in Unit model (readiness module)
        await tx.unit.update({
            where: { id: unitId },
            data: { 
                current_stage: stage,
                status_note: `Blocked - In Preparation (${stage})`
            }
        });

        // Create history record
        await tx.unitHistory.create({
            data: {
                unitId,
                userId,
                action: 'PREP_STAGE_CHANGED',
                newStatus: stage,
                timestamp: new Date()
            }
        });

        return { success: true, stage };
    });
};

/**
 * Sync Move-In Status (Dashboard Visibility)
 * Ensures a MoveIn record exists for any unit with a lease or reservation.
 */
const syncMoveInStatus = async (unitId, { leaseId, bedroomId, targetDate }, tx = prisma) => {
    const logic = async (pTx) => {
        // Find existing MoveIn specifically for this lease/bedroom or an unassigned reservation placeholder
        const existingConditions = [];
        if (leaseId) {
            existingConditions.push({ leaseId });
            existingConditions.push({ leaseId: null });
        } else {
            existingConditions.push({ leaseId: null });
        }
        if (bedroomId) {
            existingConditions.push({ bedroomId });
        }

        const existing = await pTx.moveIn.findFirst({
            where: {
                unitId,
                status: { notIn: ['OCCUPIED', 'CANCELLED'] },
                OR: existingConditions
            }
        });

        // NEW: Renewal Prevention Logic
        if (leaseId && !existing) {
            const newLease = await pTx.lease.findUnique({ where: { id: leaseId } });
            if (newLease) {
                // Check if this tenant is already "Active" in this unit (Occupant Renewal)
                const existingActiveLease = await pTx.lease.findFirst({
                    where: {
                        unitId: unitId,
                        tenantId: newLease.tenantId,
                        status: 'Active',
                        id: { not: leaseId }
                    }
                });

                if (existingActiveLease) {
                    console.log(`[syncMoveInStatus] Skipping Move-In for Unit ${unitId} - Tenant ${newLease.tenantId} is already an active occupant (Renewal).`);
                    return null;
                }
            }
        }

        // Fetch unit to check unit_type and readiness
        const unit = await pTx.unit.findUnique({ where: { id: unitId } });
        if (!unit) return null;

        let initialStatus = 'PENDING';
        
        // MODULE 1, RULE 5: NEW_CONSTRUCTION logic
        if (unit.unit_type === 'NEW_CONSTRUCTION' && !unit.unit_ready_completed) {
            initialStatus = 'BLOCKED_IN_CONSTRUCTION';
        } 
        // MODULE 1, RULE 6: COMPLETED UNIT logic
        else if (unit.unit_type === 'COMPLETED') {
            const hasPrepTasks = await pTx.unitPrepTask.count({
                where: { unitId, status: { not: 'COMPLETED' } }
            });

            if (hasPrepTasks > 0 || unit.status_note?.includes('Preparation')) {
                initialStatus = 'BLOCKED_IN_PREPARATION';
            } else if (unit.unit_ready_completed || unit.ready_for_leasing) {
                // BUG FIX: Should be REQUIREMENTS_PENDING, not READY_FOR_MOVE_IN
                // We need to verify Rent/Deposit before it's actually "Ready"
                initialStatus = 'REQUIREMENTS_PENDING';
            }
        }

        // MODULE 1, RULE 7: PRIORITY RULE
        // IF lease exists AND unit not ready → mark as PRIORITY
        const isPriority = (leaseId !== null && initialStatus !== 'READY_FOR_MOVE_IN');
        if (isPriority !== unit.is_priority) {
            await pTx.unit.update({
                where: { id: unitId },
                data: { is_priority: isPriority }
            });
        }

        if (existing) {
            const updateData = {};
            if (leaseId && existing.leaseId !== leaseId) updateData.leaseId = leaseId;
            if (bedroomId && existing.bedroomId !== bedroomId) updateData.bedroomId = bedroomId;
            if (existing.status !== initialStatus) updateData.status = initialStatus;

            if (Object.keys(updateData).length > 0) {
                return await pTx.moveIn.update({
                    where: { id: existing.id },
                    data: updateData
                });
            }
            return existing;
        }

        // BUG FIX: Do NOT create Move-In records for units without a lease or reservation
        if (!leaseId && !unit.reserved_by_id) {
            console.log(`[syncMoveInStatus] Skipping Move-In creation for Unit ${unitId} - No Lease or Reservation found.`);
            return null;
        }

        return await pTx.moveIn.create({
            data: {
                unitId,
                leaseId: leaseId || null,
                bedroomId,
                status: initialStatus,
                targetDate: normalizeToNoon(targetDate || unit.tentative_move_in_date || new Date()),
                missingItems: ['Rent', 'Deposit', 'Insurance']
            }
        });
    };

    if (tx === prisma) {
        return await prisma.$transaction(logic);
    } else {
        return await logic(tx);
    }
};

/**
 * Create Tickets from Inspection
 * Parses inspection responses and creates maintenance tickets for damaged items.
 * Implements Rule 3.4 & 3.5: Gatekeeper for Required Tickets.
 */
const createTicketsFromInspection = async (inspectionId, userId, tx = prisma) => {
    const logic = async (pTx) => {
        const inspection = await pTx.inspection.findUnique({
            where: { id: inspectionId },
            include: { 
                responses: { include: { media: true } }, 
                unit: true,
                template: true
            }
        });

        // Filter responses that need tickets
        const damagedResponses = inspection.responses.filter(r => 
            r.response?.toLowerCase().includes('damaged') || 
            r.response?.toLowerCase().includes('poor') ||
            r.response?.toLowerCase().includes('repair') ||
            r.notes?.toLowerCase().includes('repair') ||
            r.notes?.toLowerCase().includes('damaged') ||
            r.status?.toLowerCase() === 'poor'
        );

        const createdTickets = [];

        for (const resp of damagedResponses) {
            // Module 3, Rule 3 & 4: Ticket structure and blocking logic
            // Default to required=true for MOVE_OUT, required=false for MOVE_IN (as per module rules)
            const isRequired = inspection.template.type === 'MOVE_OUT';

            const ticket = await pTx.ticket.create({
                data: {
                    userId: inspection.inspectorId,
                    propertyId: inspection.unit.propertyId,
                    unitId: inspection.unitId,
                    subject: `DEFICIENCY: ${resp.question || 'Inspection Item'}`,
                    description: `Identified during ${inspection.template.type} inspection. Notes: ${resp.notes || 'None'}`,
                    priority: isRequired ? 'High' : 'Low',
                    category: 'MAINTENANCE',
                    source: `${inspection.template.type}_INSPECTION`,
                    status: 'Open',
                    isRequired: isRequired
                }
            });

            // Create UnitPrepTask for this ticket
            await pTx.unitPrepTask.create({
                data: {
                    unitId: inspection.unitId,
                    bedroomId: inspection.bedroomId,
                    ticketId: ticket.id,
                    title: resp.question || 'Repair Item',
                    description: resp.notes,
                    isRequired: isRequired, 
                    stage: 'PENDING_TICKETS'
                }
            });

            createdTickets.push(ticket);
        }

        // Update unit status to reflect it's now in Prep Flow if it's a move-out
        if (inspection.template.type === 'MOVE_OUT' || inspection.template.type === 'VISUAL') {
            await pTx.unit.update({
                where: { id: inspection.unitId },
                data: { 
                    status_note: 'Blocked - In Preparation (Deficiencies)',
                    current_stage: 'PENDING_TICKETS'
                }
            });
        }

        return createdTickets;
    };

    if (tx === prisma) {
        return await prisma.$transaction(logic);
    } else {
        return await logic(tx);
    }
};

/**
 * Check and Auto-Progress Unit Prep Stage
 * Module 3, Rule 5 & 6: ALL required tickets MUST be completed → move to "READY FOR CLEANING"
 */
const checkAndProgressUnitPrep = async (unitId) => {
    return await prisma.$transaction(async (tx) => {
        // Find if there are any OPEN required tickets for this unit
        const openRequiredTicketsCount = await tx.ticket.count({
            where: { 
                unitId,
                isRequired: true,
                status: { notIn: ['Closed', 'Completed', 'Resolved'] }
            }
        });

        // Module 3, Rule 8: Cleaning starts ONLY AFTER required tickets done
        if (openRequiredTicketsCount === 0) {
            const unit = await tx.unit.findUnique({ where: { id: unitId } });
            
            // Only progress if we are in PENDING_TICKETS stage
            if (unit.current_stage === 'PENDING_TICKETS') {
                await tx.unit.update({
                    where: { id: unitId },
                    data: { 
                        current_stage: 'READY_FOR_CLEANING',
                        status_note: 'Blocked - In Preparation (Ready for Cleaning)'
                    }
                });

                // Log history
                await tx.unitHistory.create({
                    data: {
                        unitId,
                        userId: 1, // System or Admin ID
                        action: 'AUTO_PROGRESSED',
                        newStatus: 'READY_FOR_CLEANING',
                        timestamp: new Date()
                    }
                });

                return { autoProgressed: true, newStage: 'READY_FOR_CLEANING' };
            }
        }

        return { autoProgressed: false };
    });
};

const updateMoveInRequirement = async (moveInId, { requirement, completed }) => {
    return await prisma.$transaction(async (tx) => {
        const moveIn = await tx.moveIn.findUnique({ where: { id: moveInId } });
        if (!moveIn) throw new Error('Move-In record not found');

        let missingItems = Array.isArray(moveIn.missingItems) ? moveIn.missingItems : [];
        
        if (completed) {
            // Remove from missing items
            missingItems = missingItems.filter(item => item !== requirement);
        } else {
            // Add to missing items if not already there
            if (!missingItems.includes(requirement)) {
                missingItems.push(requirement);
            }
        }

        return await tx.moveIn.update({
            where: { id: moveInId },
            data: { missingItems }
        });
    });
};

const completeMoveIn = async (moveInId, userId) => {
    return await prisma.$transaction(async (tx) => {
        const moveIn = await tx.moveIn.findUnique({
            where: { id: moveInId },
            include: { 
                unit: { include: { property: true } }, 
                lease: { include: { tenant: true } } 
            }
        });

        if (!moveIn) throw new Error('Move-In record not found');
        if (moveIn.status === 'OCCUPIED') throw new Error('Move-In already completed.');

        // MODULE 4, RULE 9: FINAL MOVE-IN CONDITION
        
        // 1. Check if unit is ready (Physical Blocking)
        if (!moveIn.unit.unit_ready_completed && !moveIn.unit.ready_for_leasing && !moveIn.overrideFlag) {
             throw new Error('Unit is not physically ready for move-in.');
        }

        // 2. Check Requirements (Rent, Deposit, Insurance)
        if (!moveIn.overrideFlag) {
            const missingItems = Array.isArray(moveIn.missingItems) ? moveIn.missingItems : [];
            
            // Check Rent
            if (missingItems.includes('Rent')) {
                const unpaidRent = await tx.invoice.findFirst({
                    where: {
                        leaseId: moveIn.leaseId,
                        status: { not: 'paid' },
                        category: 'RENT'
                    }
                });
                if (unpaidRent) {
                    throw new AppError('Move-in blocked: Unpaid rent invoice.', 400);
                }
            }

            // Check Deposit
            if (missingItems.includes('Deposit')) {
                const unpaidDeposit = await tx.invoice.findFirst({
                    where: {
                        leaseId: moveIn.leaseId,
                        status: { not: 'paid' },
                        category: 'SECURITY_DEPOSIT'
                    }
                });
                if (unpaidDeposit) {
                    throw new AppError('Move-in blocked: Unpaid security deposit invoice.', 400);
                }
            }

            // Check Insurance
            if (missingItems.includes('Insurance')) {
                const activeInsurance = await tx.insurance.findFirst({
                    where: {
                        leaseId: moveIn.leaseId,
                        status: 'ACTIVE'
                    }
                });

                if (!activeInsurance) {
                    throw new AppError('Move-in blocked: Active insurance certificate required.', 400);
                }
            }
        }

        // 3. Check Inspection Completion
        const inspection = await tx.inspection.findFirst({
            where: {
                unitId: moveIn.unitId,
                leaseId: moveIn.leaseId,
                template: { type: 'MOVE_IN' },
                status: 'COMPLETED'
            }
        });

        if (!inspection && !moveIn.overrideFlag) {
            throw new AppError('Move-in blocked: Move-In Inspection must be completed.', 400);
        }

        // 4. Check Blocking Tickets (Deficiencies)
        const blockingTickets = await tx.ticket.findMany({
            where: {
                unitId: moveIn.unitId,
                status: { notIn: ['Closed', 'Completed', 'Resolved'] },
                isRequired: true
            }
        });

        if (blockingTickets.length > 0 && !moveIn.overrideFlag) {
            throw new AppError('Move-in blocked: Outstanding required maintenance tickets must be resolved.', 400);
        }

        // ALL CONDITIONS MET → Proceed to Final State

        // Update MoveIn record
        await tx.moveIn.update({
            where: { id: moveInId },
            data: { 
                status: 'OCCUPIED',
                actualDate: new Date()
            }
        });

        // Update Unit record (Module 4, Rule 10)
        await tx.unit.update({
            where: { id: moveIn.unitId },
            data: { 
                status: 'Occupied',
                availability_status: 'Occupied',
                reserved_flag: false,
                reserved_by_id: null,
                status_note: 'Occupied - Move-In Finalized'
            }
        });

        // Update Lease status (Module 4, Rule 11)
        if (moveIn.leaseId) {
            await tx.lease.update({
                where: { id: moveIn.leaseId },
                data: { status: 'Active' }
            });
        }

        // Add history
        await tx.unitHistory.create({
            data: {
                unitId: moveIn.unitId,
                bedroomId: moveIn.bedroomId,
                userId: userId,
                action: 'MOVE_IN_COMPLETED',
                newStatus: 'Occupied',
                timestamp: new Date()
            }
        });

        return true;
    });
};

const completeMoveOutFlow = async (moveOutId, userId) => {
    return await prisma.$transaction(async (tx) => {
        const moveOut = await tx.moveOut.findUnique({
            where: { id: moveOutId },
            include: { unit: true, lease: true }
        });

        if (!moveOut) throw new Error('Move-Out record not found');
        if (moveOut.status !== 'INSPECTIONS_COMPLETED' && moveOut.status !== 'FINAL_INSPECTION_SCHEDULED') {
             // In production, we might want to strictly enforce INSPECTIONS_COMPLETED, 
             // but user requirements say "Both inspections REQUIRED".
             // We'll enforce that both inspections exist.
             const inspections = await tx.inspection.findMany({
                 where: {
                     unitId: moveOut.unitId,
                     leaseId: moveOut.leaseId,
                     status: 'COMPLETED',
                     template: { type: { in: ['MOVE_OUT', 'VISUAL'] } }
                 },
                 include: { template: true }
             });
             const hasVisual = inspections.some(i => i.template.type === 'VISUAL');
             const hasMoveOut = inspections.some(i => i.template.type === 'MOVE_OUT');
             if (!hasVisual || !hasMoveOut) throw new Error('Both Visual and Move-Out inspections must be completed before finalizing.');
        }

        // 1. Mark Move-Out as Completed
        await tx.moveOut.update({
            where: { id: moveOutId },
            data: { 
                status: 'COMPLETED',
                actualDate: new Date(),
                managerApproved: true,
                managerId: userId
            }
        });

        // 2. Update Unit Status and Terminate Lease
        await tx.unit.update({
            where: { id: moveOut.unitId },
            data: { 
                status: 'Vacant',
                availability_status: 'Available',
                status_note: 'Vacant - In Preparation',
                current_stage: 'PENDING_TICKETS'
            }
        });

        if (moveOut.leaseId) {
            await tx.lease.update({
                where: { id: moveOut.leaseId },
                data: { status: 'TERMINATED', endDate: new Date() }
            });
            // Free up the tenant/residents from this unit
            await tx.user.updateMany({
                where: { leaseId: moveOut.leaseId, type: 'RESIDENT' },
                data: { leaseId: null, bedroomId: null, unitId: null, buildingId: null }
            });
            // Update primary tenant if no other active leases exist
            const otherLeases = await tx.lease.findFirst({
                where: { tenantId: moveOut.lease.tenantId, status: 'Active', NOT: { id: moveOut.leaseId } }
            });
            if (!otherLeases) {
                await tx.user.update({
                    where: { id: moveOut.lease.tenantId },
                    data: { bedroomId: null, unitId: null, buildingId: null }
                });
            }
        }

        // 3. Create UnitPrepTask (Entry into Flow)
        // Module 3, Rule 2: First Stage → "Pending Inspection Deficiency Tickets"
        await tx.unitPrepTask.create({
            data: {
                unitId: moveOut.unitId,
                bedroomId: moveOut.bedroomId,
                stage: 'PENDING_TICKETS',
                status: 'PENDING',
                title: 'Process Deficiency Tickets',
                description: 'Review and complete tickets generated during move-out inspections.',
                isRequired: true
            }
        });

        // 4. Log to Unit History
        await tx.unitHistory.create({
            data: {
                unitId: moveOut.unitId,
                bedroomId: moveOut.bedroomId,
                userId: userId,
                action: 'MOVE_OUT_FINALIZED',
                newStatus: 'Vacant - In Prep',
                timestamp: new Date()
            }
        });

        return true;
    });
};

const cancelMoveOutFlow = async (leaseId, userId) => {
    return await prisma.$transaction(async (tx) => {
        const moveOut = await tx.moveOut.findFirst({
            where: { leaseId, status: { notIn: ['COMPLETED', 'CANCELLED'] } }
        });

        if (!moveOut) return null; // Nothing to cancel

        // 1. Mark Move-Out as Cancelled
        await tx.moveOut.update({
            where: { id: moveOut.id },
            data: { status: 'CANCELLED' }
        });

        // 2. Log to Unit History
        await tx.unitHistory.create({
            data: {
                unitId: moveOut.unitId,
                bedroomId: moveOut.bedroomId,
                userId: userId,
                action: 'MOVE_OUT_CANCELLED',
                newStatus: 'Active',
                timestamp: new Date()
            }
        });

        return true;
    });
};

module.exports = {
    normalizeToNoon,
    initMoveOutWorkflow,
    completeInspection,
    overrideMoveIn,
    updateUnitPrepStage,
    syncMoveInStatus,
    createTicketsFromInspection,
    checkAndProgressUnitPrep,
    updateMoveInRequirement,
    completeMoveIn,
    completeMoveOutFlow,
    cancelMoveOutFlow
};
