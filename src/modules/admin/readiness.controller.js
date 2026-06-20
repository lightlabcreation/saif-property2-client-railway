const prisma = require('../../config/prisma');
const { addBusinessDays } = require('../../utils/dateUtils');
const { format } = require('date-fns');

// Helper to log administrative actions
async function logAudit(userId, action, entity, entityId, details) {
    try {
        await prisma.auditLog.create({
            data: {
                userId,
                action,
                entity,
                entityId,
                details: typeof details === 'object' ? JSON.stringify(details) : details
            }
        });
    } catch (e) {
        console.error('Audit Log Error:', e);
    }
}

// Helper to get holiday set
async function getHolidaySet() {
    const holidays = await prisma.holiday.findMany();
    return new Set(holidays.map(h => format(new Date(h.date), 'yyyy-MM-dd')));
}

/**
 * Normalizes a date to midday UTC to avoid timezone shifts (e.g., April 13 turning into April 12).
 */
function normalizeDate(dateInput) {
    if (!dateInput) return null;
    const d = new Date(dateInput);
    // Set to 12:00:00 UTC to ensure that regardless of local offset, it stays on the same calendar day
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12, 0, 0));
}

exports.getBuildings = async (req, res) => {
    try {
        const properties = await prisma.property.findMany({
            select: { id: true, name: true },
            orderBy: { name: 'asc' }
        });
        res.json(properties);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error fetching buildings' });
    }
};

exports.getReadinessStats = async (req, res) => {
    try {
        const { propertyId, showLeased } = req.query;
        const isShowLeased = showLeased === 'true';
        const where = { AND: [] };
        if (propertyId) where.AND.push({ propertyId: parseInt(propertyId) });
        
        // Match dashboard logic: Filter by lease history
        // Rule 1.5: Include units that are leased but not yet physically ready in the stats
        if (!isShowLeased) {
            where.AND.push({ 
                OR: [
                    { leases: { none: {} } },
                    { unit_ready_completed: false },
                    { ready_for_leasing: false }
                ]
            });
        }

        const units = await prisma.unit.findMany({ 
            where,
            include: { 
                bedroomsList: true,
                leases: { where: { status: 'Active' } }
            }
        });

        const totalUnits = units.length;
        const readyForLeasing = units.filter(u => u.ready_for_leasing || u.unit_status === 'ACTIVE').length;
        
        // Consistent reservation count: include units with active leases
        const reservedUnits = units.filter(u => 
            u.reserved_flag || 
            u.bedroomsList.some(b => b.reserved_flag) ||
            (u.leases && u.leases.some(l => l.status === 'Active'))
        ).length;
        
        const now = new Date();
        now.setHours(0,0,0,0);
        
        const overdueUnits = units.filter(u => {
            const milestones = [
                'gc_delivered', 'gc_deficiencies', 'gc_cleaned', 
                'ffe_installed', 'ose_installed', 'final_cleaning', 'unit_ready'
            ];
            return milestones.some(key => {
                const isCompleted = u[`${key}_completed`];
                const targetDateValue = u[`${key}_target_date`] ? new Date(u[`${key}_target_date`]).getTime() : null;
                return !isCompleted && targetDateValue && targetDateValue < now.getTime();
            });
        }).length;

        res.json({
            totalUnits,
            readyForLeasing,
            reservedUnits,
            overdueUnits
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error fetching readiness stats' });
    }
};

// GET /api/admin/readiness/dashboard
exports.getReadinessDashboard = async (req, res) => {
    try {
        const { propertyId, search, status, page = 1, limit = 15, showLeased } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);
        const take = parseInt(limit);
        const isShowLeased = showLeased === 'true';

        const where = { AND: [] };
        
        // 1. Property Filter
        if (propertyId && propertyId !== '') {
            where.AND.push({ propertyId: parseInt(propertyId) });
        }

        // Rule 1.5 & 1.6: Keep units in readiness flow if they are NOT physically ready, even if a lease exists.
        // Hide only units that are BOTH Leased AND Ready.
        if (!isShowLeased) {
            where.AND.push({
                OR: [
                    { leases: { none: {} } },
                    { unit_ready_completed: false },
                    { ready_for_leasing: false }
                ]
            });
        }

        // 3. Status Filter
        if (status) {
            if (status === 'Occupied') {
                where.AND.push({ leases: { some: { status: 'Active' } } });
            } else if (status === 'Reserved') {
                where.AND.push({
                    OR: [
                        { availability_status: 'Reserved' },
                        { reserved_flag: true },
                        { bedroomsList: { some: { reserved_flag: true } } }
                    ]
                });
            } else if (['Available', 'Unavailable'].includes(status)) {
                where.AND.push({ availability_status: status });
            } else {
                where.AND.push({ unit_status: status });
            }
        }

        // 3. Search Filter
        if (search && search !== 'null' && search !== 'undefined' && search.trim() !== '') {
            const searchVal = search.trim();
            const parts = searchVal.split('-').map(p => p.trim());
            
            const searchOR = [
                { unitNumber: { contains: searchVal } },
                { name: { contains: searchVal } },
                { property: { name: { contains: searchVal } } }
            ];

            // If it looks like a combined identifier (e.g., "93-402")
            if (parts.length >= 2 && parts[0] && parts[1]) {
                searchOR.push({
                    AND: [
                        { property: { civicNumber: { contains: parts[0] } } },
                        { unitNumber: { contains: parts[1] } }
                    ]
                });
            }

            if (where.AND) {
                where.AND.push({ OR: searchOR });
            } else {
                where.AND = [{ OR: searchOR }];
            }
        }

        const total = await prisma.unit.count({ where });
        const units = await prisma.unit.findMany({
            where,
            include: {
                property: true,
                reserved_by_user: true,
                bedroomsList: {
                    include: { reserved_by_user: true }
                },
                leases: {
                    where: { status: 'Active' },
                    include: { tenant: true }, // Include tenant for the name
                    orderBy: { createdAt: 'desc' },
                    take: 1
                }
            },
            skip,
            take,
            orderBy: { createdAt: 'desc' }
        });

        const formatted = units.map(u => {
            // --- UPDATED LOGIC: Anchor Days Late to Unit Ready Date ---
            let daysLate = 0;
            const today = new Date();
            const unitReadyTarget = u.unit_ready_target_date ? new Date(u.unit_ready_target_date) : null;
            if (unitReadyTarget && !u.unit_ready_completed && unitReadyTarget < today.setHours(0,0,0,0)) {
                const diffTime = Math.abs(today - unitReadyTarget);
                daysLate = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            }

            // Rule 4: Days on Market / Days to Lease
            let marketAge = 0;
            let marketAgeLabel = 'Days on Market';
            // Base Date: Final Cleaning (Step 5) as per Rule 4
            if (u.final_cleaning_completed_date) {
                const baseDate = new Date(u.final_cleaning_completed_date);
                const activeLease = u.leases[0];
                
                if (activeLease) {
                    // Frozen logic: Lease Date - Ready Date
                    const leaseDate = new Date(activeLease.createdAt);
                    const diffTime = Math.max(0, leaseDate - baseDate);
                    marketAge = Math.floor(diffTime / (1000 * 60 * 60 * 24));
                    marketAgeLabel = 'Days to Lease';
                } else {
                    // Live logic: Today - Ready Date
                    const diffTime = Math.max(0, today - baseDate);
                    marketAge = Math.floor(diffTime / (1000 * 60 * 60 * 24));
                }
            }

            // Dynamically compute the Status Note / Stage (Matching Client Pattern)
            let dynamicStage = 'Not Started';
            const isFullyReady = u.unit_ready_completed || u.ready_for_leasing || u.unit_status === 'ACTIVE';
            
            const findFirstPending = () => {
                const steps = [
                    { key: 'gc_delivered', label: 'GC Delivered' },
                    { key: 'gc_deficiencies', label: 'GC Deficiencies' },
                    { key: 'gc_cleaned', label: 'GC Cleaned' },
                    { key: 'ffe_installed', label: 'FF&E Installed' },
                    { key: 'final_cleaning', label: 'Final Cleaning' },
                    { key: 'ose_installed', label: 'OS&E Installed' },
                    { key: 'unit_ready', label: 'Unit Ready' }
                ];
                for (const s of steps) {
                    if (!u[`${s.key}_completed`]) return s;
                }
                return null;
            };

            const pendingStep = findFirstPending();
            if (pendingStep) {
                const tDate = u[`${pendingStep.key}_target_date`] ? new Date(u[`${pendingStep.key}_target_date`]) : null;
                const statusSuffix = (tDate && tDate < today.setHours(0,0,0,0)) ? 'Overdue' : 'Pending';
                dynamicStage = `${pendingStep.label} ${statusSuffix}`;
            }

            const hasActiveLease = u.leases.length > 0;
            const isReserved = u.is_reserved || u.reserved_flag || u.bedroomsList.some(b => b.reserved_flag) || hasActiveLease;

            // MODULE 1, RULE 1.5 & 1.6: Blocked Status Logic
            if (hasActiveLease && !isFullyReady) {
                if (u.classification === 'New Construction' || u.unit_type === 'NEW_CONSTRUCTION') {
                    dynamicStage = 'Blocked – In Construction';
                } else {
                    dynamicStage = 'Blocked – In Preparation';
                }
            } else if (isReserved) {
                dynamicStage = isFullyReady ? 'Reserved – Ready' : (pendingStep ? `Reserved – Not Ready (${pendingStep.label})` : 'Reserved – Not Ready');
            } else if (isFullyReady) {
                dynamicStage = 'Unit Ready';
            }

            // MODULE 1, RULE 1.7: Priority Logic
            // If lease exists AND unit is not ready -> Mark as Priority
            const isPriority = hasActiveLease && !isFullyReady;

            return {
                id: u.id,
                unitNumber: u.unitNumber,
                unitType: u.unitType || 'N/A', // Added Unit Type
                building: u.property.name,
                unit_status: u.unit_status,
                availability: u.leases.length > 0 ? 'Occupied' : u.availability_status,
                owner: u.current_owner || 'GC',
                stage: u.status_note || dynamicStage,
                daysLate,
                marketAge,
                marketAgeLabel,
                reserved: isReserved,
                isPriority,
                hasActiveLease,
                isActive: u.ready_for_leasing,
                reservedBy: u.leases[0]?.tenant?.name || 
                            u.reserved_by_user?.name || 
                            u.status_note || 
                            u.bedroomsList.find(b => b.reserved_flag)?.reserved_by_user?.name || 
                            null,
                moveInDate: u.leases[0]?.startDate || u.tentative_move_in_date || u.bedroomsList.find(b => b.reserved_flag)?.tentative_move_in_date,
                targetDates: {
                    gc_delivered: u.gc_delivered_target_date,
                    gc_deficiencies: u.gc_deficiencies_target_date,
                    gc_cleaned: u.gc_cleaned_target_date,
                    ffe_installed: u.ffe_installed_target_date,
                    ose_installed: u.ose_installed_target_date,
                    final_cleaning: u.final_cleaning_target_date,
                    unit_ready: u.unit_ready_target_date
                },
                manualProtection: {
                    gc_delivered: u.gc_delivered_target_manual,
                    gc_deficiencies: u.gc_deficiencies_target_manual,
                    gc_cleaned: u.gc_cleaned_target_manual,
                    ffe_installed: u.ffe_installed_target_manual,
                    ose_installed: u.ose_installed_target_manual,
                    final_cleaning: u.final_cleaning_target_manual,
                    unit_ready: u.unit_ready_target_manual
                },
                completion: {
                    gc_delivered: u.gc_delivered_completed,
                    gc_deficiencies: u.gc_deficiencies_completed,
                    gc_cleaned: u.gc_cleaned_completed,
                    ffe_installed: u.ffe_installed_completed,
                    ose_installed: u.ose_installed_completed,
                    final_cleaning: u.final_cleaning_completed,
                    unit_ready: u.unit_ready_completed
                },
                actualDates: {
                    unit_ready: u.unit_ready_completed_date
                }
            };
        });

        res.json({ units: formatted, total });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error fetching readiness dashboard' });
    }
};

// PUT /api/admin/readiness/update-step/:unitId
exports.updateReadinessStep = async (req, res) => {
    try {
        const { unitId } = req.params;
        const { stepKey, completed, completionDate, targetDate, isManual, force, recalculate } = req.body;
        const userId = req.user?.id;

        const unit = await prisma.unit.findUnique({
            where: { id: parseInt(unitId) }
        });

        if (!unit) return res.status(404).json({ message: 'Unit not found' });

        const updateData = {};
        updateData[`${stepKey}_completed`] = completed;
        updateData[`${stepKey}_completed_date`] = completed ? (completionDate ? normalizeDate(completionDate) : normalizeDate(new Date())) : null;
        
        if (targetDate) {
            // Rule: Prioritize manual entries and allow forced overwrites to fix the "Error updating" popup
            if (unit[`${stepKey}_target_manual`] && !force && !isManual) {
                return res.status(409).json({ 
                    message: 'Manual override exists.', 
                    code: 'MANUAL_OVERRIDE',
                    current: unit[`${stepKey}_target_date`],
                    proposed: targetDate
                });
            }

            updateData[`${stepKey}_target_date`] = normalizeDate(targetDate);
            if (isManual) {
                updateData[`${stepKey}_target_manual`] = true;
            }

            // Rule 7.1: Audit Logging for forced overrides
            if (force) {
                await logAudit(
                    userId, 
                    'FORCED_OVERRIDE', 
                    'Unit', 
                    unit.id, 
                    { field: `${stepKey}_target_date`, from: unit[`${stepKey}_target_date`], to: targetDate }
                );
            }
        }

        // Auto-initialize owner to GC if it's currently N/A or empty
        if (!unit.current_owner || unit.current_owner === 'N/A' || unit.current_owner === 'UNSPECIFIED') {
            updateData.current_owner = 'GC';
        }

        // --- AUTOMATION 1: Strict Sequence Check ---
        const steps = ['gc_delivered', 'gc_deficiencies', 'gc_cleaned', 'ffe_installed', 'final_cleaning', 'ose_installed', 'unit_ready'];
        const stepIndex = steps.indexOf(stepKey);

        if (completed) {
            // Can only complete if previous is done or it's the first step
            if (stepIndex > 0) {
                const prevStep = steps[stepIndex - 1];
                // Rule 3: GC Deficiencies is NO LONGER a blocking step
                if (prevStep !== 'gc_deficiencies') {
                    if (!unit[`${prevStep}_completed`] && !unit[`${prevStep}_completed_date`]) {
                        return res.status(400).json({ message: `Cannot complete ${stepKey} until ${prevStep} is done.` });
                    }
                }
            }
        } else {
            // Can only UNCOMPLETE if NEXT step is NOT DONE
            if (stepIndex < steps.length - 1) {
                const nextStep = steps[stepIndex + 1];
                const isNextStepStarted = unit[`${nextStep}_completed`] || unit[`${nextStep}_completed_date`] || unit[`${nextStep}_actual_date`];
                if (isNextStepStarted) {
                    return res.status(400).json({ message: `Cannot undo ${stepKey} because ${nextStep} is already started/complete.` });
                }
            }
        }

        // --- AUTOMATION 2: Owner Switching ---
        if (stepKey === 'gc_cleaned' && completed) {
            updateData.current_owner = 'OPERATIONS';
        } else if (stepKey === 'gc_cleaned' && !completed) {
            updateData.current_owner = 'GC';
        }

        // --- AUTOMATION 3: Step 7 Auto-Complete ---
        if (stepKey === 'final_cleaning' && completed) {
            updateData.unit_ready_completed = true;
            updateData.unit_ready_completed_date = new Date();
        }

        // --- AUTOMATION 4: Fixed Anchor Target Date Calculation ---
        if ((stepKey === 'gc_delivered' && targetDate) || (stepKey === 'gc_delivered' && recalculate)) {
            const anchorDate = targetDate ? normalizeDate(targetDate) : (unit.gc_delivered_target_date || new Date());
            const timelineUpdates = await exports.recalculateTimelineHelper(anchorDate);
            Object.assign(updateData, timelineUpdates);
        }

        // --- AUTOMATION 5: Final Activation Check (Rule 3.1) ---
        const isPhysicallyReady = (stepKey === 'final_cleaning' && completed) || unit.unit_ready_completed;
        const isManuallyApproved = (stepKey === 'activate' ? completed : unit.ready_for_leasing);
        
        if (isPhysicallyReady && isManuallyApproved) {
            updateData.unit_status = 'ACTIVE';
            updateData.availability_status = unit.reserved_flag ? 'Reserved' : 'Available';
            updateData.classification = 'Completed';
            updateData.unit_type = 'COMPLETED';
        }

        // Update Unit
        const updatedUnit = await prisma.unit.update({
            where: { id: parseInt(unitId) },
            data: updateData
        });

        res.json(updatedUnit);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error updating workflow step' });
    }
};

// GET /api/admin/readiness/settings
exports.getSettings = async (req, res) => {
    try {
        let settings = await prisma.timelineSetting.findMany();
        
        // Smart Default Seeding if empty
        if (settings.length === 0) {
            const defaults = [
                { key: 'gc_to_deficiencies', days: 5 },
                { key: 'deficiencies_to_cleaned', days: 5 },
                { key: 'cleaned_to_ffe', days: 10 },
                { key: 'ffe_to_final', days: 5 },
                { key: 'final_to_ose', days: 7 },
                { key: 'ose_to_ready', days: 2 }
            ];
            
            for (const d of defaults) {
                await prisma.timelineSetting.upsert({
                    where: { key: d.key },
                    update: {},
                    create: d
                });
            }
            settings = await prisma.timelineSetting.findMany();
        }
        
        res.json(settings);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching settings' });
    }
};

// POST /api/admin/readiness/settings
exports.updateSettings = async (req, res) => {
    try {
        const { settings, triggerRecalculate } = req.body; 
        for (const s of settings) {
            await prisma.timelineSetting.upsert({
                where: { key: s.key },
                update: { days: parseInt(s.days) },
                create: { key: s.key, days: parseInt(s.days) }
            });
        }

        // Rule 1: Trigger global recalculation if requested
        if (triggerRecalculate) {
           await recalculateAllUnitTimelines();
        }

        res.json({ message: 'Settings updated' });
    } catch (error) {
        res.status(500).json({ message: 'Error updating settings' });
    }
};

// --- HOLIDAY CALENDAR ENDPOINTS ---
exports.getHolidays = async (req, res) => {
    try {
        const holidays = await prisma.holiday.findMany({ orderBy: { date: 'asc' } });
        res.json(holidays);
    } catch (e) {
        res.status(500).json({ message: 'Error fetching holidays' });
    }
};

exports.addHoliday = async (req, res) => {
    try {
        const { date, name } = req.body;
        const holiday = await prisma.holiday.create({ data: { date: new Date(date), name } });
        res.json(holiday);
    } catch (e) {
        res.status(500).json({ message: 'Error adding holiday' });
    }
};

exports.deleteHoliday = async (req, res) => {
    try {
        await prisma.holiday.delete({ where: { id: parseInt(req.params.id) } });
        res.json({ message: 'Holiday deleted' });
    } catch (e) {
        res.status(500).json({ message: 'Error deleting holiday' });
    }
};

// Reusable Timeline Helper
exports.recalculateTimelineHelper = async (inputAnchorDate) => {
    const settings = await prisma.timelineSetting.findMany();
    const setMap = settings.reduce((acc, s) => ({ ...acc, [s.key]: s.days }), {});
    const holiSet = await getHolidaySet();
    const anchorDate = normalizeDate(inputAnchorDate);
    
    const defDays = parseInt(setMap['gc_to_deficiencies']) || 5;
    const cleanDays = parseInt(setMap['deficiencies_to_cleaned']) || 5;
    const ffeDays = parseInt(setMap['cleaned_to_ffe']) || 10;
    const finalDays = parseInt(setMap['ffe_to_final']) || 5;
    const oseDays = parseInt(setMap['final_to_ose']) || 7;
    const readyDays = parseInt(setMap['ose_to_ready']) || 2;

    const updates = {};
    updates.gc_deficiencies_target_date = addBusinessDays(anchorDate, defDays, holiSet);
    updates.gc_cleaned_target_date = addBusinessDays(updates.gc_deficiencies_target_date, cleanDays, holiSet);
    updates.ffe_installed_target_date = addBusinessDays(updates.gc_cleaned_target_date, ffeDays, holiSet);
    updates.final_cleaning_target_date = addBusinessDays(updates.ffe_installed_target_date, finalDays, holiSet);
    updates.ose_installed_target_date = addBusinessDays(updates.final_cleaning_target_date, oseDays, holiSet);
    updates.unit_ready_target_date = addBusinessDays(updates.ose_installed_target_date, readyDays, holiSet);
    
    return updates;
};

// POST /api/admin/readiness/holidays
async function recalculateAllUnitTimelines() {
    const units = await prisma.unit.findMany({
        where: { gc_delivered_completed: true, unit_ready_completed: false }
    });
    
    const settings = await prisma.timelineSetting.findMany();
    const setMap = settings.reduce((acc, s) => ({ ...acc, [s.key]: s.days }), {});
    const holiSet = await getHolidaySet();

    for (const u of units) {
        const anchorDate = normalizeDate(u.gc_delivered_target_date || new Date());
        const updates = {};
        
        const defDays = setMap['gc_to_deficiencies'] || 5;
        const cleanDays = setMap['deficiencies_to_cleaned'] || 5;
        const ffeDays = setMap['cleaned_to_ffe'] || 10;
        const finalDays = setMap['ffe_to_final'] || 5;
        const oseDays = setMap['final_to_ose'] || 7;
        const readyDays = setMap['ose_to_ready'] || 2;

        updates.gc_deficiencies_target_date = addBusinessDays(anchorDate, defDays, holiSet);
        updates.gc_cleaned_target_date = addBusinessDays(updates.gc_deficiencies_target_date, cleanDays, holiSet);
        updates.ffe_installed_target_date = addBusinessDays(updates.gc_cleaned_target_date, ffeDays, holiSet);
        updates.final_cleaning_target_date = addBusinessDays(updates.ffe_installed_target_date, finalDays, holiSet);
        updates.ose_installed_target_date = addBusinessDays(updates.final_cleaning_target_date, oseDays, holiSet);
        updates.unit_ready_target_date = addBusinessDays(updates.ose_installed_target_date, readyDays, holiSet);

        if (Object.keys(updates).length > 0) {
            await prisma.unit.update({ where: { id: u.id }, data: updates });
        }
    }
}

exports.activateUnit = async (req, res) => {
    try {
        const { unitId } = req.params;
        const { ready } = req.body;
        const updateData = {
            ready_for_leasing: ready,
            unit_status: ready ? 'ACTIVE' : 'INACTIVE',
            availability_status: ready ? 'Available' : 'Unavailable',
            classification: ready ? 'Completed' : undefined,
            unit_type: ready ? 'COMPLETED' : undefined
        };
        const updated = await prisma.unit.update({
            where: { id: parseInt(unitId) },
            data: updateData
        });
        res.json(updated);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error activating unit' });
    }
};
