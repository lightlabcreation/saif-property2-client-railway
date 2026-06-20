const bcrypt = require('bcrypt');
const crypto = require('crypto');
const prisma = require('../../config/prisma');
const smsService = require('../../services/sms.service');
const emailService = require('../../services/email.service');
const AppError = require('../../utils/AppError');
const catchAsync = require('../../utils/catchAsync');
const allowedOrigins = require('../../config/allowedOrigins');
const { proxyRequest } = require('./shuttle.controller');


// GET /api/admin/tenants
exports.getAllTenants = async (req, res) => {
    try {
        const { propertyId, search, page = 1, limit = 10, includePast, status } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);
        const take = parseInt(limit);

        const whereClause = { role: 'TENANT' }; // Show all tenants including residents as requested

        // Handle Status Filter (e.g. status=Active)
        if (status === 'Active') {
            const now = new Date();
            whereClause.AND = [
                {
                    OR: [
                        { 
                            leases: { 
                                some: { 
                                    status: 'Active',
                                    OR: [
                                        { endDate: null },
                                        { endDate: { gte: now } }
                                    ]
                                } 
                            } 
                        },
                        { 
                            residentLease: { 
                                status: 'Active',
                                OR: [
                                    { endDate: null },
                                    { endDate: { gte: now } }
                                ]
                            } 
                        },
                        {
                            type: 'RESIDENT',
                            parentId: { not: null },
                            parent: {
                                leases: {
                                    some: {
                                        status: 'Active',
                                        OR: [
                                            { endDate: null },
                                            { endDate: { gte: now } }
                                        ]
                                    }
                                }
                            }
                        }
                    ]
                }
            ];
        }

        if (propertyId) {
            const pId = parseInt(propertyId);
            const propertyCondition = {
                OR: [
                    {
                        leases: {
                            some: {
                                unit: { propertyId: pId }
                            }
                        }
                    },
                    {
                        buildingId: pId
                    }
                ]
            };

            if (whereClause.AND) {
                whereClause.AND.push(propertyCondition);
            } else {
                whereClause.OR = propertyCondition.OR;
            }
        }

        if (search) {
            const searchTerms = search.split(' ').filter(term => term.length > 0);
            const searchConditions = searchTerms.map(term => ({
                OR: [
                    { firstName: { contains: term } },
                    { lastName: { contains: term } },
                    { name: { contains: term } },
                    { email: { contains: term } },
                    { phone: { contains: term } },
                    { companyName: { contains: term } },
                    { 
                        leases: {
                            some: {
                                unit: {
                                    OR: [
                                        { unitNumber: { contains: term } },
                                        { property: { name: { contains: term } } }
                                    ]
                                }
                            }
                        }
                    },
                    {
                        residentLease: {
                            unit: {
                                OR: [
                                    { unitNumber: { contains: term } },
                                    { property: { name: { contains: term } } }
                                ]
                            }
                        }
                    }
                ]
            }));

            if (whereClause.OR) {
                // If we already have a propertyId filter, we need to AND the search conditions
                whereClause.AND = searchConditions;
            } else {
                whereClause.AND = searchConditions;
            }
        }

        const [tenants, totalCount] = await Promise.all([
            prisma.user.findMany({
                where: whereClause,
                include: {
                    building: true,
                    unit: { include: { property: true } },
                    leases: {
                        include: {
                            unit: {
                                include: {
                                    property: true
                                }
                            }
                        }
                    },
                    insurances: true,
                    documents: true,
                    residents: {
                        include: {
                            residentLease: {
                                include: { unit: true }
                            },
                            leases: {
                                include: { unit: true }
                            }
                        }
                    },
                    parent: {
                        include: {
                            leases: true
                        }
                    },
                    companyContacts: true,
                    residentLease: {
                        include: {
                            unit: {
                                include: {
                                    property: true
                                }
                            }
                        }
                    }
                },
                orderBy: { id: 'desc' },
                skip,
                take
            }),
            prisma.user.count({ where: whereClause })
        ]);

        // Fetch communication logs for credential invitations to identify who has already been invited
        const tenantEmails = tenants.map(t => t.email).filter(Boolean);
        const tenantPhones = tenants.map(t => t.phone).filter(Boolean);

        const inviteLogs = await prisma.communicationLog.findMany({
            where: {
                OR: [
                    { recipient: { in: tenantEmails } },
                    { recipient: { in: tenantPhones } }
                ],
                eventType: 'TENANT_CREATION_CREDENTIALS',
                status: 'Sent'
            },
            select: { recipient: true }
        });

        const invitedRecipients = new Set(inviteLogs.map(log => log.recipient));

        // Fetch all units and properties into a map for fast lookup of resident assignments
        const units = await prisma.unit.findMany({ include: { property: true } });
        const unitMap = new Map(units.map(u => [u.id, u]));

        const formatted = tenants.map(t => {
            // Find active lease first, fallback to most recent inactive one for billing history
            let activeLease = t.leases.find(l => l.status === 'Active') ||
                (t.residentLease?.status === 'Active' ? t.residentLease : null) ||
                t.leases.find(l => l.status === 'DRAFT') ||
                (t.residentLease?.status === 'DRAFT' ? t.residentLease : null);
            
            // If No Active Lease, find the last one they had (Broken/Expired/etc)
            if (!activeLease && t.leases.length > 0) {
                activeLease = [...t.leases].sort((a,b) => new Date(b.endDate) - new Date(a.endDate))[0];
            }

            // Find property name from any available source
            let propName = t.building?.name || t.unit?.property?.name || activeLease?.unit?.property?.name || 'No Property';
            let uName = t.unit?.unitNumber || t.unit?.name || activeLease?.unit?.name || 'No Unit';
            let lStatus = activeLease ? activeLease.status : 'Inactive';

            if (t.type === 'RESIDENT' && t.unitId) {
                const assignedUnit = unitMap.get(t.unitId);
                if (assignedUnit) {
                    propName = assignedUnit.property?.name || 'No Property';
                    uName = assignedUnit.unitNumber || assignedUnit.name || 'No Unit';

                    // Validate: Resident is Active ONLY if the Parent has an active lease for this specific unit
                    const parentHasLease = t.parent?.leases?.some(l => l.unitId === t.unitId && l.status === 'Active');
                    lStatus = parentHasLease ? 'Active' : 'Inactive';
                }
            }

            // Inherit from residents if parent has no active lease (UI helper)
            if (!activeLease && t.residents?.length > 0) {
                const residentWithLease = t.residents.find(r => r.residentLease?.status === 'Active' || r.leases?.some(l => l.status === 'Active'));
                if (residentWithLease) lStatus = 'Active';
            }

            let displayName = t.name || `${t.firstName || ''} ${t.lastName || ''}`.trim();
            if (t.type === 'COMPANY' && t.companyName) displayName = t.companyName;

            return {
                id: t.id,
                name: displayName,
                firstName: t.firstName || (t.name ? t.name.split(' ')[0] : ''),
                lastName: t.lastName || (t.name ? t.name.split(' ').slice(1).join(' ') : ''),
                type: t.type || 'Individual',
                companyName: t.companyName,
                email: t.email,
                phone: t.phone,
                propertyId: t.buildingId || t.unit?.propertyId || activeLease?.unit?.propertyId || (t.type === 'RESIDENT' && t.unitId ? unitMap.get(t.unitId)?.propertyId : null),
                unitId: activeLease?.unitId || t.unitId || null,
                leaseId: activeLease?.id || null,
                bedroomId: activeLease?.bedroomId || t.bedroomId || null,
                property: propName,
                unit: uName,
                leaseStatus: lStatus,
                leaseStartDate: activeLease?.startDate || null,
                leaseEndDate: activeLease?.endDate || null,
                activeLeaseRole: activeLease ? (t.leases.find(l => l.id === activeLease.id) ? 'TENANT' : 'RESIDENT') : null,
                rentAmount: activeLease?.monthlyRent || 0,
                insurance: t.insurances,
                documents: t.documents,
                leases: t.leases, // TargetLintErrorIds
                parentId: t.parentId,
                parentName: t.parent ? t.parent.name || `${t.parent.firstName || ''} ${t.parent.lastName || ''}`.trim() : null,
                hasPortalAccess: !!t.password,
                companyContacts: t.companyContacts,
                isInviteSent: (t.email && invitedRecipients.has(t.email)) || (t.phone && invitedRecipients.has(t.phone)),
                companyDetails: t.companyDetails,
                street: t.street,
                city: t.city,
                state: t.state,
                postalCode: t.postalCode,
                country: t.country
            };
        });
        let finalFormatted = formatted;
        if (status === 'Active') {
            finalFormatted = formatted.filter(t => t.leaseStatus === 'Active');
        }

        res.json({
            data: finalFormatted,
            meta: {
                total: totalCount,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(totalCount / parseInt(limit))
            }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
};

// GET /api/admin/tenants/:id
exports.getTenantById = async (req, res) => {
    try {
        const { id } = req.params;
        const tenantId = parseInt(id);

        let tenant = await prisma.user.findUnique({
            where: { id: tenantId },
            include: {
                leases: {
                    include: { unit: { include: { property: true } } }
                },
                insurances: true,
                documents: true, // Direct ownership documents
                residents: true,
                residentLease: {
                    include: { unit: { include: { property: true } } }
                },
                parent: true
            }
        });

        if (!tenant) return res.status(404).json({ message: 'Tenant not found' });

        // If no lease, check for direct assignment (for Residents)
        if (tenant.unitId) {
            const directUnit = await prisma.unit.findUnique({
                where: { id: tenant.unitId },
                include: { property: true }
            });
            if (directUnit) {
                tenant.assignedUnit = directUnit;
            }
        }

        // Fetch documents linked via DocumentLink (entityType="USER", entityId=tenantId)
        const linkedDocuments = await prisma.document.findMany({
            where: {
                links: {
                    some: {
                        entityType: 'USER',
                        entityId: tenantId
                    }
                }
            },
            include: {
                links: true
            }
        });

        // Combine direct documents and linked documents, removing duplicates
        const allDocumentsMap = new Map();

        // Add direct ownership documents
        tenant.documents.forEach(doc => {
            allDocumentsMap.set(doc.id, doc);
        });

        // Add linked documents
        linkedDocuments.forEach(doc => {
            allDocumentsMap.set(doc.id, doc);
        });

        // Replace tenant.documents with combined list, formatting dates
        tenant.documents = Array.from(allDocumentsMap.values()).map(doc => ({
            ...doc,
            expiryDate: doc.expiryDate ? doc.expiryDate.toISOString().split('T')[0] : null,
            createdAt: doc.createdAt ? doc.createdAt.toISOString() : doc.createdAt,
            updatedAt: doc.updatedAt ? doc.updatedAt.toISOString() : doc.updatedAt
        }));

        res.json(tenant);
    } catch (error) {
        console.error('Get Tenant By ID Error:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// POST /api/admin/tenants
exports.createTenant = catchAsync(async (req, res, next) => {
    const {
        firstName, lastName, email, type, unitId, bedroomId, propertyId,
        companyName, companyDetails, residents, parentId,
        street, city, state, postalCode, country
    } = req.body;
    let { phone, password } = req.body;

    const errors = {};
    if (!firstName) errors.firstName = 'First name is required';
    if (!lastName) errors.lastName = 'Last name is required';

    // Type-specific validations
    const normalizedType = type ? type.toUpperCase() : 'INDIVIDUAL';

    if (normalizedType === 'COMPANY' && !companyName) {
        errors.companyName = 'Company name is required for Company tenants';
    }

    if (normalizedType === 'RESIDENT' && !parentId) {
        errors.parentId = 'Parent tenant (Responsible Party) is required for Residents';
    }

    // Phone Validation
    if (!phone) {
        errors.phone = 'Phone number is required';
    } else {
        // Normalize Phone (E.164 focus for Canadian/US)
        let cleanPhone = phone.replace(/[\s-()]/g, '');
        if (cleanPhone.length === 10 && /^\d+$/.test(cleanPhone)) {
            phone = '+1' + cleanPhone;
        } else if (cleanPhone.length === 11 && cleanPhone.startsWith('1')) {
            phone = '+' + cleanPhone;
        } else {
            phone = cleanPhone;
        }

        // Basic check: must be at least 10 digits
        if (phone.length < 10) {
            errors.phone = 'Invalid phone number format';
        }
    }

    if (Object.keys(errors).length > 0) {
        const err = new AppError('Validation failed', 400);
        err.errors = errors;
        throw err;
    }

    // 1. Password Logic (Moved to Lease Creation)
    let hashedPassword = null;

    // Transaction to ensure atomicity
    const result = await prisma.$transaction(async (prisma) => {
        // Check if email already exists (only if email is provided and not empty)
        if (email && email.trim() !== '') {
            const existingUser = await prisma.user.findUnique({
                where: { email: email.trim() }
            });

            if (existingUser) {
                const err = new AppError('A user with this email already exists', 409);
                err.errors = { email: 'This email is already registered.' };
                throw err;
            }
        }

        // 1. Create User (Tenant/Resident)
        const normalizedType = type ? type.toUpperCase() : 'INDIVIDUAL';
        let sanitizedParentId = (parentId && !isNaN(parseInt(parentId))) ? parseInt(parentId) : null;
        let sanitizedBuildingId = (propertyId && !isNaN(parseInt(propertyId))) ? parseInt(propertyId) : null;
        let sanitizedUnitId = (unitId && !isNaN(parseInt(unitId))) ? parseInt(unitId) : null;
        let sanitizedBedroomId = (bedroomId && !isNaN(parseInt(bedroomId))) ? parseInt(bedroomId) : null;

        if (normalizedType === 'RESIDENT') {
            if (!sanitizedParentId) {
                const err = new AppError('Responsible Party is required for Residents', 400);
                err.errors = { parentId: 'Responsible Party is required' };
                throw err;
            }

            // Residents inherit location from parent ALWAYS if not provided
            const parent = await prisma.user.findUnique({
                where: { id: sanitizedParentId },
                include: {
                    leases: { where: { status: 'Active' }, take: 1 }
                }
            });

            if (parent) {
                sanitizedBuildingId = sanitizedBuildingId || parent.buildingId;
                sanitizedUnitId = sanitizedUnitId || parent.unitId;
                sanitizedBedroomId = sanitizedBedroomId || parent.bedroomId;
                // STOPS: Linking resident to parent's lease. Residents should be occupants only.
                // req.body.leaseId = null; 
            }
        }

        const inviteToken = normalizedType !== 'RESIDENT' ? crypto.randomBytes(32).toString('hex') : null;
        const inviteExpires = normalizedType !== 'RESIDENT' ? new Date() : null;
        if (inviteExpires) inviteExpires.setDate(inviteExpires.getDate() + 7);

        const newUser = await prisma.user.create({
            data: {
                name: `${firstName} ${lastName}`.trim(),
                firstName,
                lastName,
                email: (email && email.trim() !== '') ? email.trim() : null,
                phone,
                type: normalizedType,
                companyName: normalizedType === 'COMPANY' ? (companyName || null) : null,
                companyDetails: normalizedType === 'COMPANY' ? (companyDetails || null) : null,
                street: street || null,
                city: city || null,
                state: state || null,
                postalCode: postalCode || null,
                country: country || null,
                role: 'TENANT',
                buildingId: sanitizedBuildingId,
                unitId: sanitizedUnitId,
                bedroomId: sanitizedBedroomId,
                parentId: sanitizedParentId,
                leaseId: normalizedType === 'RESIDENT' ? null : (req.body.leaseId || null), // Residents never have leases
                password: hashedPassword,
                inviteToken,
                inviteExpires,
            }
        });

        // Handle Company Contacts
        if (normalizedType === 'COMPANY' && req.body.companyContacts && Array.isArray(req.body.companyContacts)) {
            await prisma.companyContact.createMany({
                data: req.body.companyContacts.map(c => ({
                    companyId: newUser.id,
                    name: c.name,
                    email: c.email,
                    phone: c.phone,
                    role: c.role
                }))
            });
        }

        // 5. Handle Sub-Residents (If any provided for Individual/Company)
        if (normalizedType !== 'RESIDENT' && residents && Array.isArray(residents) && residents.length > 0) {
            await prisma.user.createMany({
                data: residents.filter(r => r.firstName || r.lastName).map(r => ({
                    firstName: r.firstName || '',
                    lastName: r.lastName || '',
                    name: `${r.firstName || ''} ${r.lastName || ''}`.trim(),
                    parentId: newUser.id,
                    role: 'TENANT',
                    type: 'RESIDENT'
                }))
            });
        }

        return newUser;
    });

    // 2. Phase 2: Create user in Shuttle automatically (Async Hook)
    if (result && result.email) {
        proxyRequest('POST', '/auth/internal-create', {
            name: result.name,
            email: result.email,
            phone: result.phone,
            role: 'tenant',
            source: 'PMS'
        }).catch(err => console.error('Shuttle sync failed on creation:', err.message));
    }

    res.status(201).json({
        success: true,
        message: 'Tenant created successfully.',
        data: result
    });
});


// DELETE
exports.deleteTenant = async (req, res) => {
    try {
        const id = parseInt(req.params.id);

        // Phase 2: Automatic Revocation (Delete from Shuttle)
        const tenant = await prisma.user.findUnique({ where: { id } });
        if (tenant && tenant.email) {
            // Delete by email if it exists
            proxyRequest('DELETE', `/users/email/${tenant.email}`).catch(err => {
                console.error('Shuttle revocation failed during deletion:', err.message);
            });
        }

        await prisma.$transaction(async (tx) => {
            // 1. Clear references in other tables (Gatekeepers)
            await tx.company.updateMany({
                where: { primaryContactId: id },
                data: { primaryContactId: null }
            });
            
            await tx.unit.updateMany({
                where: { reserved_by_id: id },
                data: {
                    reserved_flag: false,
                    reserved_by_id: null,
                    reservation_date: null,
                    tentative_move_in_date: null
                }
            });

            await tx.bedroom.updateMany({
                where: { reserved_by_id: id },
                data: {
                    reserved_flag: false,
                    reserved_by_id: null,
                    reservation_date: null,
                    tentative_move_in_date: null
                }
            });

            // 2. Find any lease (Active or Draft) to vacate unit and bedrooms
            const anyLease = await tx.lease.findFirst({
                where: { tenantId: id, status: { in: ['Active', 'DRAFT'] } }
            });

            if (anyLease) {
                await tx.bedroom.updateMany({
                    where: { unitId: anyLease.unitId, status: 'Occupied' },
                    data: { status: 'Vacant' }
                });
                await tx.unit.update({
                    where: { id: anyLease.unitId },
                    data: { status: 'Vacant' }
                });
            }

            // 3. Deep Cleanup (Ordered for Constraints)
            // Residents: Handle them first as they are dependents
            const residentIds = (await tx.user.findMany({ where: { parentId: id }, select: { id: true } })).map(u => u.id);
            const allTargetIds = [id, ...residentIds];

            // Messages & Logs
            await tx.message.deleteMany({ where: { OR: [{ senderId: { in: allTargetIds } }, { receiverId: { in: allTargetIds } }] } });
            await tx.communicationLog.deleteMany({ where: { recipientId: { in: allTargetIds } } });
            await tx.refreshToken.deleteMany({ where: { userId: { in: allTargetIds } } });
            await tx.quickBooksConfig.deleteMany({ where: { userId: { in: allTargetIds } } });
            await tx.permission.deleteMany({ where: { userId: { in: allTargetIds } } });

            // Maintenance & Workflow
            await tx.ticket.deleteMany({ where: { userId: { in: allTargetIds } } });
            await tx.vehicle.deleteMany({ where: { tenantId: { in: allTargetIds } } });
            await tx.refundAdjustment.deleteMany({ where: { tenantId: { in: allTargetIds } } });

            // Invoices & Financials
            const invoiceIds = (await tx.invoice.findMany({ where: { tenantId: { in: allTargetIds } }, select: { id: true } })).map(i => i.id);
            if (invoiceIds.length > 0) {
                await tx.transaction.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
                await tx.payment.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
                await tx.invoiceLineItem.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
                // Documents linked to invoices
                await tx.document.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
            }
            await tx.invoice.deleteMany({ where: { tenantId: { in: allTargetIds } } });

            // Leases & Inspections
            const leaseIds = (await tx.lease.findMany({ where: { tenantId: { in: allTargetIds } }, select: { id: true } })).map(l => l.id);
            if (leaseIds.length > 0) {
                await tx.inspection.deleteMany({ where: { leaseId: { in: leaseIds } } });
                await tx.moveIn.deleteMany({ where: { leaseId: { in: leaseIds } } });
                await tx.moveOut.deleteMany({ where: { leaseId: { in: leaseIds } } });
            }
            await tx.lease.deleteMany({ where: { tenantId: { in: allTargetIds } } });

            // Final Document Cleanup (User Docs & Links)
            const allDocs = await tx.document.findMany({ 
                where: { 
                    OR: [
                        { userId: { in: allTargetIds } },
                        { leaseId: { in: leaseIds } }
                    ]
                },
                select: { id: true }
            });
            const allDocIds = allDocs.map(d => d.id);
            
            if (allDocIds.length > 0) {
                await tx.documentLink.deleteMany({ where: { documentId: { in: allDocIds } } });
                await tx.insurance.deleteMany({ where: { OR: [{ userId: { in: allTargetIds } }, { uploadedDocumentId: { in: allDocIds } }] } });
                await tx.document.deleteMany({ where: { id: { in: allDocIds } } });
            } else {
                await tx.insurance.deleteMany({ where: { userId: { in: allTargetIds } } });
            }

            await tx.companyContact.deleteMany({ where: { companyId: { in: allTargetIds } } });

            // 4. Finally Delete Users
            await tx.user.deleteMany({ where: { parentId: id } });
            await tx.user.delete({ where: { id } });
        });

        res.json({ message: 'Deleted' });
    } catch (e) {
        console.error('Delete Tenant Error:', e);
        res.status(500).json({ message: 'Error deleting tenant' });
    }
};

// PUT /api/admin/tenants/:id
exports.updateTenant = catchAsync(async (req, res, next) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
        return next(new AppError('Invalid tenant ID', 400));
    }

    const {
        firstName, lastName, email, type, unitId, bedroomId, propertyId,
        companyName, companyDetails, residents, parentId,
        street, city, state, postalCode, country
    } = req.body;
    let { phone } = req.body;

    const errors = {};
    if (!firstName) errors.firstName = 'First name is required';
    if (!lastName) errors.lastName = 'Last name is required';

    // Phone Validation
    if (!phone) {
        errors.phone = 'Phone number is required';
    } else {
        // Normalize Phone
        let cleanPhone = phone.replace(/[\s-()]/g, '');
        if (cleanPhone.length === 10 && /^\d+$/.test(cleanPhone)) {
            phone = '+1' + cleanPhone;
        } else if (cleanPhone.length === 11 && cleanPhone.startsWith('1')) {
            phone = '+' + cleanPhone;
        } else {
            phone = cleanPhone;
        }
        if (phone.length < 10) {
            errors.phone = 'Invalid phone number format';
        }
    }

    if (Object.keys(errors).length > 0) {
        const err = new AppError('Validation failed', 400);
        err.errors = errors;
        throw err;
    }

    const normalizedType = type ? type.toUpperCase() : undefined;

    // Transaction
    const updatedTenant = await prisma.$transaction(async (prisma) => {
        // Check email uniqueness if email is provided
        if (email) {
            const existingUser = await prisma.user.findFirst({
                where: {
                    email,
                    id: { not: id } // Exclude self
                }
            });

            if (existingUser) {
                const err = new AppError('A user with this email already exists', 409);
                err.errors = { email: 'This email is already taken by another user.' };
                throw err;
            }
        }

        let sanitizedParentId = (parentId && !isNaN(parseInt(parentId))) ? parseInt(parentId) : (normalizedType === 'RESIDENT' ? undefined : null);
        let sanitizedBuildingId = propertyId ? parseInt(propertyId) : null;
        let sanitizedUnitId = unitId ? parseInt(unitId) : null;
        let sanitizedBedroomId = bedroomId ? parseInt(bedroomId) : null;
        let sanitizedLeaseId = req.body.leaseId ? parseInt(req.body.leaseId) : undefined;

        if (normalizedType === 'RESIDENT' && sanitizedParentId) {
            const parent = await prisma.user.findUnique({
                where: { id: sanitizedParentId },
                include: {
                    leases: { where: { status: 'Active' }, take: 1 }
                }
            });
            if (parent) {
                sanitizedBuildingId = sanitizedBuildingId || parent.buildingId;
                sanitizedUnitId = sanitizedUnitId || parent.unitId;
                sanitizedBedroomId = sanitizedBedroomId || parent.bedroomId;
                sanitizedLeaseId = null; // Residents never assigned to leases
            }
        }

        // 1. Update basic info
        const user = await prisma.user.update({
            where: { id },
            data: {
                name: `${firstName} ${lastName}`.trim(),
                firstName,
                lastName,
                email,
                phone,
                type: normalizedType,
                companyName: normalizedType === 'COMPANY' ? (companyName || null) : null,
                companyDetails: normalizedType === 'COMPANY' ? (companyDetails || null) : null,
                street: street !== undefined ? street : undefined,
                city: city !== undefined ? city : undefined,
                state: state !== undefined ? state : undefined,
                postalCode: postalCode !== undefined ? postalCode : undefined,
                country: country !== undefined ? country : undefined,
                buildingId: sanitizedBuildingId,
                unitId: sanitizedUnitId,
                bedroomId: sanitizedBedroomId,
                parentId: sanitizedParentId !== undefined ? sanitizedParentId : null,
                leaseId: sanitizedLeaseId !== undefined ? sanitizedLeaseId : null
            }
        });

        // Handle Company Contacts Sync
        if (normalizedType === 'COMPANY' && req.body.companyContacts && Array.isArray(req.body.companyContacts)) {
            await prisma.companyContact.deleteMany({ where: { companyId: id } });
            await prisma.companyContact.createMany({
                data: req.body.companyContacts.map(c => ({
                    companyId: id,
                    name: c.name,
                    email: c.email,
                    phone: c.phone,
                    role: c.role
                }))
            });
        }

        // Sync Residents (for Individual/Company): clean resident-related data first, then delete, then create
        if (normalizedType !== 'RESIDENT' && residents && Array.isArray(residents)) {
            const currentLease = await prisma.lease.findFirst({
                where: { tenantId: id, status: { in: ['ACTIVE', 'Active', 'DRAFT'] } }
            });

            const residentIds = (await prisma.user.findMany({ where: { parentId: id }, select: { id: true } })).map(u => u.id);
            if (residentIds.length > 0) {
                await prisma.refreshToken.deleteMany({ where: { userId: { in: residentIds } } });
                await prisma.insurance.deleteMany({ where: { userId: { in: residentIds } } });
                await prisma.document.deleteMany({ where: { userId: { in: residentIds } } });
                await prisma.ticket.deleteMany({ where: { userId: { in: residentIds } } });
                await prisma.message.deleteMany({ where: { OR: [{ senderId: { in: residentIds } }, { receiverId: { in: residentIds } }] } });
                await prisma.communicationLog.deleteMany({ where: { recipientId: { in: residentIds } } });
                await prisma.quickBooksConfig.deleteMany({ where: { userId: { in: residentIds } } });
            }
            await prisma.user.deleteMany({ where: { parentId: id } });
            if (residents.length > 0) {
                await prisma.user.createMany({
                    data: residents.filter(r => r.firstName || r.lastName).map(r => ({
                        parentId: id,
                        leaseId: currentLease?.id ?? null,
                        firstName: r.firstName || '',
                        lastName: r.lastName || '',
                        name: `${r.firstName || ''} ${r.lastName || ''}`.trim(),
                        role: 'TENANT',
                        type: 'RESIDENT'
                    }))
                });
            }
        }

        return user;
    });

    // 3. Handle Bedroom/Unit Change (Logic now relies on the transaction result or parameters)
    // NOTE: This logic was outside transaction in original code. 
    // Ideally it should be inside or handled safely. 
    // Keeping logic structure but ensuring errors bubble up.

    let newUnitId = unitId ? parseInt(unitId) : null;
    let newBedroomId = bedroomId ? parseInt(bedroomId) : null;

    if (newBedroomId) {
        const bedroom = await prisma.bedroom.findUnique({
            where: { id: newBedroomId }
        });
        if (bedroom) {
            newUnitId = bedroom.unitId;
        }
    }

    if (newUnitId && normalizedType !== 'RESIDENT' && normalizedType !== 'COMPANY') {
        const currentLease = await prisma.lease.findFirst({
            where: {
                tenantId: id,
                status: { in: ['ACTIVE', 'Active', 'DRAFT'] }
            }
        });

        const leaseType = newBedroomId ? 'BEDROOM' : 'FULL_UNIT';

        if (currentLease && currentLease.unitId !== newUnitId) {
            // Logic to move lease
            if (currentLease.status === 'ACTIVE' || currentLease.status === 'Active') {
                await prisma.lease.update({
                    where: { id: currentLease.id },
                    data: { status: 'MOVED', endDate: new Date() }
                });

                await prisma.lease.create({
                    data: {
                        tenantId: id,
                        unitId: newUnitId,
                        bedroomId: newBedroomId || null,
                        leaseType: leaseType,
                        status: 'ACTIVE',
                    }
                });
            } else {
                await prisma.lease.update({
                    where: { id: currentLease.id },
                    data: {
                        unitId: newUnitId,
                        bedroomId: newBedroomId || null,
                        leaseType: leaseType
                    }
                });
            }
        } else if (!currentLease) {
            // Logic to create new lease if none existed (implied by original code logic flow)
            await prisma.lease.create({
                data: {
                    tenantId: id,
                    unitId: newUnitId,
                    bedroomId: newBedroomId || null,
                    leaseType: leaseType,
                    status: 'ACTIVE',
                }
            });
        }
    }

    res.json({
        success: true,
        message: 'Tenant updated successfully',
        data: updatedTenant
    });
});

// GET /api/admin/tenants/:id/tickets
exports.getTenantTickets = async (req, res) => {
    try {
        const { id } = req.params;
        const tickets = await prisma.ticket.findMany({
            where: { userId: parseInt(id) },
            orderBy: { createdAt: 'desc' }
        });

        const formatted = tickets.map(t => ({
            id: t.id + 1000,
            title: t.subject,
            category: 'General', // Fallback as schema doesn't have category
            priority: t.priority,
            status: t.status,
            date: t.createdAt.toISOString().split('T')[0]
        }));

        res.json(formatted);
    } catch (error) {
        console.error('Fetch Tenant Tickets Error:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// POST /api/admin/tenants/:id/send-invite
exports.sendInvite = catchAsync(async (req, res, next) => {
    const id = parseInt(req.params.id);
    const { methods } = req.body; // ['email', 'sms']

    if (isNaN(id)) {
        throw new AppError('Invalid tenant ID', 400);
    }

    if (!methods || !Array.isArray(methods) || methods.length === 0) {
        throw new AppError('Please select at least one delivery method (Email or SMS)', 400);
    }

    const tenant = await prisma.user.findUnique({
        where: { id },
        include: { parent: true }
    });

    if (!tenant) {
        throw new AppError('Tenant not found', 404);
    }

    // Block invitations for residents
    if (tenant.type === 'RESIDENT') {
        throw new AppError('Residents do not have portal access and cannot be invited.', 400);
    }

    const recipientUser = tenant;

    let password = null;
    let hashedPassword = undefined;

    // If user has no password, generate one
    if (!recipientUser.password) {
        password = Math.floor(100000 + Math.random() * 900000).toString();
        hashedPassword = await bcrypt.hash(password, 10);
    }

    const inviteToken = crypto.randomBytes(32).toString('hex');
    const inviteExpires = new Date();
    inviteExpires.setDate(inviteExpires.getDate() + 7);

    // Update recipient with new credentials/token
    const updatedUser = await prisma.user.update({
        where: { id: recipientUser.id },
        data: {
            ...(hashedPassword ? { password: hashedPassword } : {}),
            inviteToken,
            inviteExpires
        }
    });

    const requestOrigin = req.get('origin') || req.get('referer')?.split('/').slice(0, 3).join('/');
    const cleanOrigin = requestOrigin?.replace(/\/$/, ''); // Remove trailing slash
    const isAllowed = allowedOrigins.some(o => o.replace(/\/$/, '') === cleanOrigin);

    const loginUrl = (cleanOrigin && isAllowed ? cleanOrigin : process.env.FRONTEND_URL) || "https://masteko-pm.ca";

    const inviteLink = `${loginUrl}/tenant/invite/${inviteToken}`;

    let welcomeMsg = `Welcome to Property Management! \n\nYour login credentials for the portal: \nEmail: ${updatedUser.email}`;
    if (password) {
        welcomeMsg += ` \nPassword: ${password}`;
    }
    welcomeMsg += ` \n\nAccess your portal here: ${inviteLink}`;

    const results = {
        email: { attempted: false, success: false },
        sms: { attempted: false, success: false }
    };

    if (methods.includes('email')) {
        results.email.attempted = true;
        if (!updatedUser.email) {
            results.email.error = 'No email address on file';
        } else {
            try {
                const eRes = await emailService.sendEmail(updatedUser.email, 'Welcome - Your Portal Access', welcomeMsg);
                results.email.success = eRes.success;
                if (!eRes.success) results.email.error = eRes.error;
            } catch (err) {
                results.email.error = err.message;
            }
        }
    }

    if (methods.includes('sms')) {
        results.sms.attempted = true;
        if (!updatedUser.phone) {
            results.sms.error = 'No phone number on file';
        } else {
            try {
                const sRes = await smsService.sendSMS(updatedUser.phone, welcomeMsg);
                results.sms.success = sRes.success;
                if (!sRes.success) results.sms.error = sRes.error;
            } catch (err) {
                results.sms.error = err.message;
            }
        }
    }

    res.json({
        success: true,
        message: 'Invitations processed',
        data: {
            recipient: updatedUser.email,
            results,
            inviteLink // Still return for admin convenience
        }
    });
});
