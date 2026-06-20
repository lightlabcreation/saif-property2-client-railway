const prisma = require('../../config/prisma');
const communicationService = require('../../services/communicationService');

// GET /api/admin/insurance/compliance
exports.getComplianceDashboard = async (req, res) => {
    try {
        // First, ensure all statuses are up to date
        await exports.checkInsuranceExpirations();

        // Fetch all active leases with their units, properties, and residents (tenants)
        const activeLeases = await prisma.lease.findMany({
            where: { status: 'Active' },
            include: {
                unit: { include: { property: true } },
                tenant: {
                    include: {
                        insurances: {
                            where: { status: { in: ['ACTIVE', 'EXPIRING_SOON', 'EXPIRED'] } },
                            orderBy: { endDate: 'desc' }
                        }
                    }
                },
                residents: {
                    include: {
                        insurances: {
                            where: { status: { in: ['ACTIVE', 'EXPIRING_SOON', 'EXPIRED'] } },
                            orderBy: { endDate: 'desc' }
                        }
                    }
                }
            }
        });

        const formatted = [];

        activeLeases.forEach(lease => {
            const propertyName = lease.unit?.property?.name || 'N/A';
            const unitName = lease.unit?.unitNumber || lease.unit?.name || 'N/A';
            const unitId = lease.unit?.id || null;
            const leaseId = lease.id || null;

            // Collect all unique residents (primary tenant + additional residents)
            const rawResidents = [lease.tenant, ...(lease.residents || [])].filter(Boolean);
            const residentMap = new Map();
            rawResidents.forEach(r => residentMap.set(r.id, r));
            const allResidents = Array.from(residentMap.values());
            
            // Find all insurance records for this lease across all residents
            const allInsurances = allResidents.flatMap(r => r.insurances || []);
            
            // Filter insurances that are specifically linked to this lease OR this unit
            let matchingInsurances = allInsurances.filter(ins => ins.leaseId === leaseId || ins.unitId === unitId);
            
            // If no specific match, try to find any active/expiring insurance for these residents 
            // (Shared policy scenario where only one person uploaded it)
            if (matchingInsurances.length === 0 && allInsurances.length > 0) {
                // Pick the most recent one as a representative policy if it's generally active
                matchingInsurances = [allInsurances[0]]; 
            }

            if (matchingInsurances.length === 0) {
                // For each resident, show as MISSING if no insurance found for the lease
                allResidents.forEach(resident => {
                    const residentName = resident.name || `${resident.firstName || ''} ${resident.lastName || ''}`.trim();
                    formatted.push({
                        tenantId: resident.id,
                        tenantName: residentName,
                        tenantType: resident.type,
                        building: propertyName,
                        unitNumber: unitName,
                        status: 'MISSING',
                        daysRemaining: null,
                        provider: 'N/A',
                        policyNumber: 'N/A',
                        startDate: 'N/A',
                        expiryDate: 'N/A',
                        notes: '',
                        insuranceId: null,
                        unitId,
                        leaseId,
                        documentUrl: null,
                        uploadedDocumentId: null
                    });
                });
            } else {
                // We have insurance. We should show the status based on the best available policy for the lease.
                const statusPriority = { 'ACTIVE': 3, 'EXPIRING_SOON': 2, 'EXPIRED': 1 };
                matchingInsurances.sort((a,b) => (statusPriority[b.status] || 0) - (statusPriority[a.status] || 0));
                
                const bestInsurance = matchingInsurances[0];
                const today = new Date();
                today.setHours(0,0,0,0);
                const end = new Date(bestInsurance.endDate);
                const daysRemaining = Math.ceil((end - today) / (1000 * 60 * 60 * 24));

                allResidents.forEach(resident => {
                    const residentName = resident.name || `${resident.firstName || ''} ${resident.lastName || ''}`.trim();
                    formatted.push({
                        tenantId: resident.id,
                        tenantName: residentName,
                        tenantType: resident.type,
                        building: propertyName,
                        unitNumber: unitName,
                        status: bestInsurance.status,
                        daysRemaining,
                        provider: bestInsurance.provider || 'N/A',
                        policyNumber: bestInsurance.policyNumber || 'N/A',
                        startDate: bestInsurance.startDate ? bestInsurance.startDate.toISOString().split('T')[0] : 'N/A',
                        expiryDate: bestInsurance.endDate ? bestInsurance.endDate.toISOString().split('T')[0] : 'N/A',
                        notes: bestInsurance.notes || '',
                        insuranceId: bestInsurance.id,
                        unitId,
                        leaseId,
                        documentUrl: bestInsurance.documentUrl || null,
                        uploadedDocumentId: bestInsurance.uploadedDocumentId || null
                    });
                });
            }
        });

        res.json(formatted);
    } catch (e) {
        console.error('Compliance Dashboard Error:', e);
        res.status(500).json({ message: 'Server error' });
    }
};

// Internal function to check and send alerts & update statuses
exports.checkInsuranceExpirations = async () => {
    console.log('[Insurance] Checking for expiring policies per client limits (15 days)');
    const today = new Date();
    today.setHours(0,0,0,0);

    try {
        const activeInsurances = await prisma.insurance.findMany({
            where: { status: { in: ['ACTIVE', 'EXPIRING_SOON'] } }
        });

        for (const ins of activeInsurances) {
            const end = new Date(ins.endDate);
            const diffDays = Math.ceil((end - today) / (1000 * 60 * 60 * 24));

            let newStatus = ins.status;
            if (diffDays <= 0) {
                newStatus = 'EXPIRED';
            } else if (diffDays <= 15) {
                newStatus = 'EXPIRING_SOON';
            }

            if (newStatus !== ins.status) {
                await prisma.insurance.update({
                    where: { id: ins.id },
                    data: { status: newStatus }
                });
                console.log(`[Insurance] Updated policy ${ins.id} status to ${newStatus}`);
            }
        }
    } catch (e) {
        console.error('Check Expirations Error:', e);
    }
};

// GET /api/admin/insurance/alerts
exports.getInsuranceAlerts = async (req, res) => {
    try {
        const { status } = req.query; // Filter by status if provided

        const where = {
            user: {
                role: 'TENANT',
                type: { not: 'RESIDENT' },
                leases: { some: { status: 'Active' } }
            }
        };
        if (status) {
            where.status = status;
        }

        const insurances = await prisma.insurance.findMany({
            where,
            include: {
                user: true,
                lease: {
                    include: {
                        unit: { include: { property: true } }
                    }
                },
                unit: { include: { property: true } }
            },
            orderBy: { createdAt: 'desc' }
        });

        const getExpiryStatus = (endDate, status) => {
            if (status === 'EXPIRED') return { label: 'Expired', color: 'red', days: 0 };
            if (status === 'EXPIRING_SOON') return { label: 'Expiring Soon', color: 'amber', days: 15 };
            if (status === 'ARCHIVED') return { label: 'Archived', color: 'gray', days: 0 };
            
            const end = new Date(endDate);
            const today = new Date();
            const diffTime = end - today;
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

            if (diffDays <= 0) return { label: 'Expired', color: 'red', days: diffDays };
            if (diffDays <= 15) return { label: 'Expiring Soon', color: 'amber', days: diffDays };
            return { label: 'Active', color: 'emerald', days: diffDays };
        };

        const formatted = insurances.map(ins => {
            const unit = ins.unit || ins.lease?.unit;
            const expiry = getExpiryStatus(ins.endDate, ins.status);

            return {
                id: ins.id,
                tenantName: ins.user?.name || 'N/A',
                property: unit ? unit.property.name : 'Unknown',
                unit: unit ? unit.name : 'N/A',
                provider: ins.provider,
                policyNumber: ins.policyNumber,
                startDate: ins.startDate.toISOString().substring(0, 10),
                endDate: ins.endDate.toISOString().substring(0, 10),
                documentUrl: (ins.documentUrl && ins.uploadedDocumentId)
                    ? `/api/admin/documents/${ins.uploadedDocumentId}/download?disposition=inline`
                    : ins.documentUrl,
                uploadedDocumentId: ins.uploadedDocumentId,
                status: ins.status,
                rejectionReason: ins.rejectionReason,
                notes: ins.notes,
                expiry: expiry,
                tenantId: ins.userId,
                unitId: ins.unitId
            };
        });

        res.json(formatted);
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Server error' });
    }
};

// POST /api/admin/insurance/:id/approve
exports.approveInsurance = async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const insurance = await prisma.insurance.update({
            where: { id },
            data: { status: 'ACTIVE', rejectionReason: null }
        });

        // Trigger notification Logic
        try {
            await communicationService.sendInsuranceApproved(insurance.userId, insurance.id);
        } catch (e) { console.error('Notification failed:', e); }

        res.json({ message: 'Insurance approved successfully', insurance });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Failed to approve insurance' });
    }
};

// POST /api/admin/insurance/:id/reject
exports.rejectInsurance = async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const { reason } = req.body;

        if (!reason) {
            return res.status(400).json({ message: 'Rejection reason is required' });
        }

        const insurance = await prisma.insurance.update({
            where: { id },
            data: { status: 'REJECTED', rejectionReason: reason }
        });

        // Trigger notification Logic
        try {
            await communicationService.sendInsuranceRejected(insurance.userId, insurance.id, reason);
        } catch (e) { console.error('Notification failed:', e); }

        res.json({ message: 'Insurance rejected successfully', insurance });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Failed to reject insurance' });
    }
};

// GET /api/admin/insurance/stats
exports.getInsuranceStats = async (req, res) => {
    try {
        // Ensure data is fresh
        await exports.checkInsuranceExpirations();

        // We count based on active leases
        const activeLeases = await prisma.lease.findMany({
            where: { status: 'Active' },
            include: {
                tenant: {
                    include: {
                        insurances: {
                            where: { status: { in: ['ACTIVE', 'EXPIRING_SOON', 'EXPIRED'] } }
                        }
                    }
                },
                residents: {
                    include: {
                        insurances: {
                            where: { status: { in: ['ACTIVE', 'EXPIRING_SOON', 'EXPIRED'] } }
                        }
                    }
                }
            }
        });

        let active = 0;
        let expiring = 0;
        let expired = 0;
        let missing = 0;
        let pending = 0;

        activeLeases.forEach(lease => {
            const allResidents = [lease.tenant, ...(lease.residents || [])].filter(Boolean);
            const allInsurances = allResidents.flatMap(r => r.insurances || []);
            
            // Check if ANY insurance covers this lease
            const leaseInsurances = allInsurances.filter(ins => ins.leaseId === lease.id || ins.unitId === lease.unitId);
            
            if (leaseInsurances.length === 0 && allInsurances.length > 0) {
                // If no specific link but resident has insurance, count it (shared policy fallback)
                leaseInsurances.push(allInsurances[0]);
            }

            if (leaseInsurances.length === 0) {
                missing += allResidents.length;
            } else {
                // Determine best status for the lease
                const statuses = leaseInsurances.map(i => i.status);
                if (statuses.includes('ACTIVE')) {
                    active += allResidents.length;
                } else if (statuses.includes('EXPIRING_SOON')) {
                    expiring += allResidents.length;
                } else if (statuses.includes('EXPIRED')) {
                    expired += allResidents.length;
                } else if (statuses.includes('PENDING_APPROVAL')) {
                    pending += allResidents.length;
                }
            }
        });

        res.json({
            active,
            expiring,
            expired,
            pending,
            missing
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Failed to fetch insurance stats' });
    }
};

// POST /api/admin/insurance
exports.createInsurance = async (req, res) => {
    try {
        const { userId, provider, policyNumber, endDate, startDate, documentUrl, uploadedDocumentId, notes, unitId, leaseId } = req.body;

        if (!userId || !endDate) {
            return res.status(400).json({ message: 'Tenant ID and Expiry Date are required' });
        }

        const data = {
            userId: parseInt(userId),
            provider: provider || 'TBD',
            policyNumber: policyNumber || 'TBD',
            startDate: startDate ? new Date(startDate) : new Date(),
            endDate: new Date(endDate),
            documentUrl: documentUrl || null,
            uploadedDocumentId: uploadedDocumentId ? parseInt(uploadedDocumentId) : null,
            notes: notes || null,
            status: 'ACTIVE',
            unitId: unitId ? parseInt(unitId) : null,
            leaseId: leaseId ? parseInt(leaseId) : null
        };

        // If today is within 15 days of end date, map straight to EXPIRING_SOON
        const today = new Date();
        today.setHours(0,0,0,0);
        const end = new Date(data.endDate);
        const diffDays = Math.ceil((end - today) / (1000 * 60 * 60 * 24));
        if (diffDays <= 0) {
            data.status = 'EXPIRED';
        } else if (diffDays <= 15) {
            data.status = 'EXPIRING_SOON';
        }

        // Archive previous active records in transaction
        const result = await prisma.$transaction(async (tx) => {
            // Find records for the SAME unitId to avoid cross-unit archiving
            await tx.insurance.updateMany({
                where: { 
                    userId: data.userId, 
                    unitId: data.unitId,
                    status: { in: ['ACTIVE', 'EXPIRING_SOON'] } 
                },
                data: { status: 'ARCHIVED' }
            });
            return await tx.insurance.create({ data });
        });

        res.status(201).json(result);
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Failed to create insurance' });
    }
};

// PUT /api/admin/insurance/:id
exports.updateInsurance = async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const { provider, policyNumber, endDate, documentUrl, uploadedDocumentId, notes } = req.body;

        const updateData = {};
        if (provider) updateData.provider = provider;
        if (policyNumber) updateData.policyNumber = policyNumber;
        if (documentUrl !== undefined) updateData.documentUrl = documentUrl;
        if (uploadedDocumentId !== undefined) updateData.uploadedDocumentId = uploadedDocumentId ? parseInt(uploadedDocumentId) : null;
        if (notes !== undefined) updateData.notes = notes;
        
        if (endDate) {
            const end = new Date(endDate);
            updateData.endDate = end;
            
            // Re-evaluate status
            const current = await prisma.insurance.findUnique({ where: { id } });
            if (current && ['ACTIVE', 'EXPIRING_SOON', 'EXPIRED'].includes(current.status)) {
                const today = new Date();
                today.setHours(0,0,0,0);
                const diffDays = Math.ceil((end - today) / (1000 * 60 * 60 * 24));
                if (diffDays <= 0) {
                    updateData.status = 'EXPIRED';
                } else if (diffDays <= 15) {
                    updateData.status = 'EXPIRING_SOON';
                } else {
                    updateData.status = 'ACTIVE';
                }
            }
        }

        const updated = await prisma.insurance.update({
            where: { id },
            data: updateData
        });

        res.json(updated);
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Failed to update insurance' });
    }
};
