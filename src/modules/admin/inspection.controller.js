const prisma = require('../../config/prisma');
const workflowService = require('../../services/workflow.service');
const { cloudinary } = require('../../config/cloudinary');
const { generateInspectionPDF } = require('../../utils/pdf.utils');

// Upload base64 image string directly to Cloudinary
const uploadBase64ToCloudinary = (base64String, folder = 'inspection_photos') => {
    return new Promise((resolve, reject) => {
        cloudinary.uploader.upload(
            base64String,
            { folder, resource_type: 'image' },
            (error, result) => {
                if (error) reject(error);
                else resolve(result.secure_url);
            }
        );
    });
};

/**
 * Inspection Controller
 * Handles templates and inspection records
 */

const createTemplate = async (req, res) => {
    try {
        const { name, type, structure } = req.body;
        const template = await prisma.inspectionTemplate.create({
            data: { name, type, structure }
        });
        res.status(201).json({ success: true, data: template });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const getTemplates = async (req, res) => {
    try {
        const { type } = req.query;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        const where = type ? { type } : {};

        const [templates, total] = await Promise.all([
            prisma.inspectionTemplate.findMany({
                where,
                skip,
                take: limit,
                orderBy: { createdAt: 'desc' }
            }),
            prisma.inspectionTemplate.count({ where })
        ]);

        res.json({ 
            success: true, 
            data: templates,
            pagination: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const createInspection = async (req, res) => {
    try {
        const { templateId, unitId, leaseId, bedroomId, date, time } = req.body;
        const inspectorId = req.body.inspectorId ? parseInt(req.body.inspectorId) : (req.user?.id || 1);

        // Check if template exists
        if (!templateId || isNaN(parseInt(templateId))) {
            return res.status(400).json({ success: false, message: 'Please select a valid inspection template.' });
        }

        const template = await prisma.inspectionTemplate.findUnique({ where: { id: parseInt(templateId) } });
        if (!template) return res.status(404).json({ success: false, message: 'Template not found' });

        // Lock template
        await prisma.inspectionTemplate.update({
            where: { id: templateId },
            data: { isLocked: true }
        });

        const inspection = await prisma.inspection.create({
            data: {
                templateId,
                unitId,
                leaseId,
                bedroomId,
                inspectorId,
                status: 'DRAFT'
            }
        });

        // WORKFLOW SYNC: Update Move-Out status to IN_PROGRESS when inspection starts
        if (template.type === 'VISUAL' || template.type === 'MOVE_OUT') {
            const moveOut = await prisma.moveOut.findFirst({
                where: { 
                    leaseId: inspection.leaseId,
                    status: { notIn: ['COMPLETED', 'CANCELLED'] }
                }
            });

            if (moveOut) {
                const column = template.type === 'VISUAL' ? 'visualInspectionId' : 'finalInspectionId';
                const dateColumn = template.type === 'VISUAL' ? 'visualDate' : 'finalDate';
                const timeColumn = template.type === 'VISUAL' ? 'visualTime' : 'finalTime';
                
                const currentMoveOut = await prisma.moveOut.findUnique({ where: { id: moveOut.id } });
                const willHaveVisual = template.type === 'VISUAL' || currentMoveOut.visualInspectionId;
                const willHaveFinal = template.type === 'MOVE_OUT' || currentMoveOut.finalInspectionId;

                const newStatus = (willHaveVisual && willHaveFinal) ? 'INSPECTION_IN_PROGRESS' : currentMoveOut.status;

                // Safe Date Formatting
                let dateUpdateStr = 'NULL';
                if (date) {
                    try {
                        const d = new Date(date);
                        if (!isNaN(d.getTime())) {
                            dateUpdateStr = `'${d.toISOString().slice(0, 19).replace('T', ' ')}'`;
                        }
                    } catch (e) {
                        console.error('Date parsing failed:', e);
                    }
                }

                await prisma.$executeRawUnsafe(`UPDATE moveout SET status = '${newStatus}', ${column} = ${inspection.id}, ${dateColumn} = ${dateUpdateStr}, ${timeColumn} = ${time ? `'${time}'` : 'NULL'} WHERE id = ${moveOut.id}`);
            }
        }

        res.status(201).json({ success: true, data: inspection });
    } catch (error) {
        console.error('CREATE_INSPECTION_ERROR:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

const submitInspection = async (req, res) => {
    try {
        const { id } = req.params;
        const { signature, inspectorSignature, noDeficiencyConfirmed, responses } = req.body;

        const inspection = await prisma.inspection.findUnique({
            where: { id: parseInt(id) },
            include: { template: true }
        });

        if (!inspection) return res.status(404).json({ success: false, message: 'Inspection not found' });

        // Validate completion rules
                // 1. Dual signatures are mandatory unless no deficiency is confirmed
        if (!noDeficiencyConfirmed) {
            if (!signature) return res.status(400).json({ success: false, message: 'Tenant signature is required.' });
            if (!inspectorSignature) return res.status(400).json({ success: false, message: 'Inspector signature is required.' });

        }

        // 2. All line items must be reviewed (checked on frontend, but we store them here)

        // 2. Save or update responses (with Cloudinary photo upload)
        if (responses && responses.length > 0) {
            for (const resp of responses) {
                const photos = resp.photos || (resp.photo ? [resp.photo] : []);
                const uploadedUrls = [];

                for (const photoData of photos) {
                    if (photoData.startsWith('data:image')) {
                        try {
                            const url = await uploadBase64ToCloudinary(photoData, 'inspection_photos');
                            uploadedUrls.push(url);
                        } catch (uploadErr) {
                            console.error('Cloudinary upload failed:', uploadErr.message);
                        }
                    } else if (photoData.startsWith('http')) {
                        uploadedUrls.push(photoData);
                    }
                }

                const primaryPhoto = uploadedUrls[0] || null;

                let dbResponse;
                if (resp.id) {
                    dbResponse = await prisma.inspectionItemResponse.update({
                        where: { id: resp.id },
                        data: {
                            response: resp.response,
                            notes: resp.notes,
                            annotation: resp.annotation,
                            photoUrl: primaryPhoto
                        }
                    });
                } else {
                    dbResponse = await prisma.inspectionItemResponse.create({
                        data: {
                            inspectionId: parseInt(id),
                            question: resp.question || 'Unknown',
                            response: resp.response,
                            notes: resp.notes,
                            annotation: resp.annotation,
                            photoUrl: primaryPhoto
                        }
                    });
                }

                // Update Media Table
                if (uploadedUrls.length > 0) {
                    // Clear old media for this response if updating
                    if (resp.id) {
                        await prisma.inspectionMedia.deleteMany({ where: { responseId: dbResponse.id } });
                    }
                    
                    await prisma.inspectionMedia.createMany({
                        data: uploadedUrls.map(url => ({
                            responseId: dbResponse.id,
                            url: url
                        }))
                    });
                }
            }
        }

        // 3. Complete workflow and generate tickets
        const result = await workflowService.completeInspection(parseInt(id), {
            signature,
            inspectorSignature,
            noDeficiencyConfirmed
        });

        res.json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const enrichInspectionTenant = async (inspection) => {
    if (inspection?.lease?.tenant?.name) {
        return inspection;
    }
    try {
        if (inspection.leaseId) {
            const lease = await prisma.lease.findUnique({
                where: { id: inspection.leaseId },
                include: { tenant: true }
            });
            if (lease?.tenant?.name) {
                inspection.lease = {
                    ...inspection.lease,
                    tenant: lease.tenant
                };
                return inspection;
            }
        }
        let linkedLeaseId = inspection.leaseId;
        if (!linkedLeaseId) {
            const moveOut = await prisma.moveOut.findFirst({
                where: {
                    OR: [
                        { visualInspectionId: inspection.id },
                        { finalInspectionId: inspection.id }
                    ]
                },
                include: {
                    lease: { include: { tenant: true } }
                }
            });
            if (moveOut?.lease?.tenant?.name) {
                inspection.lease = moveOut.lease;
                return inspection;
            }
        }
        const lastMoveOutHistory = await prisma.unitHistory.findFirst({
            where: {
                unitId: inspection.unitId,
                action: 'MOVE_OUT_INITIATED'
            },
            include: { user: true },
            orderBy: { timestamp: 'desc' }
        });
        if (lastMoveOutHistory?.user?.name) {
            inspection.lease = {
                ...inspection.lease,
                tenant: {
                    name: lastMoveOutHistory.user.name,
                    phone: lastMoveOutHistory.user.phone
                }
            };
            return inspection;
        }
    } catch (e) {
        console.error('Error during tenant lookup fallback:', e);
    }
    return inspection;
};

const getAllInspections = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        const [inspections, total] = await Promise.all([
            prisma.inspection.findMany({
                include: {
                    template: true,
                    unit: true,
                    lease: { include: { tenant: true } },
                    inspector: { select: { id: true, name: true } },
                    tickets: true
                },
                orderBy: { createdAt: 'desc' },
                skip,
                take: limit
            }),
            prisma.inspection.count()
        ]);

        const enriched = await Promise.all(inspections.map(enrichInspectionTenant));

        res.json({ 
            success: true, 
            data: enriched,
            pagination: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const updateInspection = async (req, res) => {
    try {
        const { id } = req.params;
        const { responses, signature, noDeficiencyConfirmed } = req.body;
        const userId = req.user.id;

        const existing = await prisma.inspection.findUnique({
            where: { id: parseInt(id) },
            include: { responses: true }
        });

        if (!existing) return res.status(404).json({ success: false, message: 'Inspection not found' });

        const updates = {};
        const auditLogs = [];

        // Track changes for Audit Log
        if (signature && signature !== existing.tenantSignature) {
            auditLogs.push({
                userId,
                action: 'UPDATE_SIGNATURE',
                entity: 'Inspection',
                entityId: parseInt(id),
                details: `Signature changed from ${existing.tenantSignature ? 'Existing' : 'None'} to New Signature`
            });
        }
         if (signature !== undefined) {
            updates.tenantSignature = signature;
        }
        if (req.body.status !== undefined) {
            updates.status = req.body.status;
        }
        if (req.body.inspectorSignature !== undefined) {
            updates.inspectorSignature = req.body.inspectorSignature;
        }

        await prisma.$transaction(async (tx) => {
            // Update main inspection record
            if (Object.keys(updates).length > 0) {
                await tx.inspection.update({
                    where: { id: parseInt(id) },
                    data: updates
                });

                // If cancelled, reset the Move-Out workflow
                if (updates.status === 'CANCELLED') {
                    const inspection = await tx.inspection.findUnique({
                        where: { id: parseInt(id) },
                        include: { template: true }
                    });

                    if (inspection && inspection.leaseId && (inspection.template?.type === 'MOVE_OUT' || inspection.template?.type === 'VISUAL')) {
                        await tx.moveOut.updateMany({
                            where: { leaseId: inspection.leaseId },
                            data: {
                                status: 'CONFIRMED',
                                visualDate: null,
                                visualTime: null,
                                finalDate: null,
                                finalTime: null,
                                visualInspectionId: null,
                                finalInspectionId: null
                            }
                        });
                    }
                }
            }

            // Update responses and log changes
            if (responses && responses.length > 0) {
                for (const resp of responses) {
                    const oldResp = existing.responses.find(r => r.id === resp.id);
                    
                    // PHOTO HANDLING IN EDIT MODE
                    const photos = resp.photos || (resp.photo ? [resp.photo] : []);
                    const uploadedUrls = [];
                    let photoChanged = false;

                    for (const photoData of photos) {
                        if (photoData.startsWith('data:image')) {
                            try {
                                const url = await uploadBase64ToCloudinary(photoData, 'inspection_photos');
                                uploadedUrls.push(url);
                                photoChanged = true;
                            } catch (uploadErr) {
                                console.error('Cloudinary upload failed during update:', uploadErr.message);
                            }
                        } else if (photoData.startsWith('http')) {
                            uploadedUrls.push(photoData);
                        }
                    }

                    const primaryPhoto = uploadedUrls[0] || null;

                    if (oldResp) {
                        const changes = [];
                        if (resp.response !== oldResp.response) changes.push(`Response: ${oldResp.response} -> ${resp.response}`);
                        if (resp.notes !== oldResp.notes) changes.push(`Notes changed`);
                        if (resp.annotation !== oldResp.annotation) changes.push(`Annotation changed`);

                        // Check if photos array actually changed
                        const oldMediaUrls = oldResp.media?.map(m => m.url) || (oldResp.photoUrl ? [oldResp.photoUrl] : []);
                        if (uploadedUrls.length !== oldMediaUrls.length || !uploadedUrls.every(url => oldMediaUrls.includes(url))) {
                            photoChanged = true;
                            changes.push('Photos updated');
                        }

                        if (changes.length > 0) {
                            auditLogs.push({
                                userId,
                                action: 'UPDATE_RESPONSE',
                                entity: 'InspectionItemResponse',
                                entityId: resp.id,
                                details: changes.join(', ')
                            });

                            await tx.inspectionItemResponse.update({
                                where: { id: resp.id },
                                data: {
                                    response: resp.response,
                                    notes: resp.notes,
                                    annotation: resp.annotation,
                                    photoUrl: primaryPhoto
                                }
                            });

                            if (photoChanged) {
                                await tx.inspectionMedia.deleteMany({ where: { responseId: resp.id } });
                                if (uploadedUrls.length > 0) {
                                    await tx.inspectionMedia.createMany({
                                        data: uploadedUrls.map(url => ({
                                            responseId: resp.id,
                                            url: url
                                        }))
                                    });
                                }
                            }
                        }
                    } else {
                        // CREATE new response if it didn't exist before
                        const newResp = await tx.inspectionItemResponse.create({
                            data: {
                                inspectionId: parseInt(id),
                                question: resp.question || 'Unknown',
                                response: resp.response,
                                notes: resp.notes,
                                annotation: resp.annotation,
                                photoUrl: primaryPhoto
                            }
                        });

                        if (uploadedUrls.length > 0) {
                            await tx.inspectionMedia.createMany({
                                data: uploadedUrls.map(url => ({
                                    responseId: newResp.id,
                                    url: url
                                }))
                            });
                        }

                        auditLogs.push({
                            userId,
                            action: 'CREATE_RESPONSE',
                            entity: 'InspectionItemResponse',
                            entityId: newResp.id,
                            details: `New response added during edit: ${resp.response}`
                        });
                    }
                }
            }

            // Create Audit Logs
            if (auditLogs.length > 0) {
                await tx.auditLog.createMany({
                    data: auditLogs
                });
            }
        });

        res.json({ success: true, message: 'Inspection updated and changes logged.' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const downloadInspectionPDF = async (req, res) => {
    try {
        const { id } = req.params;
        const inspection = await prisma.inspection.findUnique({
            where: { id: parseInt(id) },
            include: {
                template: true,
                responses: true,
                unit: { include: { property: true } },
                lease: { include: { tenant: true } },
                inspector: { select: { id: true, name: true } },
                tickets: true
            }
        });

        if (!inspection) {
            return res.status(404).json({ success: false, message: 'Inspection not found' });
        }

        const enriched = await enrichInspectionTenant(inspection);
        await generateInspectionPDF(enriched, res);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const getInspectionDetails = async (req, res) => {
    try {
        const { id } = req.params;
        const inspection = await prisma.inspection.findUnique({
            where: { id: parseInt(id) },
            include: {
                template: true,
                responses: {
                    include: { media: true }
                },
                unit: true,
                lease: { include: { tenant: true } },
                inspector: { select: { id: true, name: true, email: true } },
                tickets: true
            }
        });

        if (!inspection) return res.status(404).json({ success: false, message: 'Inspection not found' });

        // WORKFLOW SYNC: If this is being viewed, mark the Move-Out flow as "In Progress"
        if (inspection.status === 'DRAFT' && inspection.leaseId && (inspection.template?.type === 'MOVE_OUT' || inspection.template?.type === 'VISUAL')) {
            try {
                const moveOut = await prisma.moveOut.findFirst({
                    where: { 
                        leaseId: inspection.leaseId,
                        status: { in: ['VISUAL_INSPECTION_SCHEDULED', 'FINAL_INSPECTION_SCHEDULED', 'CONFIRMED'] }
                    }
                });

                if (moveOut) {
                    if (moveOut.visualInspectionId && moveOut.finalInspectionId) {
                        await prisma.$executeRaw`UPDATE moveout SET status = 'INSPECTION_IN_PROGRESS' WHERE id = ${moveOut.id}`;
                    }
                }
            } catch (workflowErr) {
                console.error('Workflow Sync Error (In Progress):', workflowErr.message);
                // Non-blocking for inspection view
            }
        }

        const enriched = await enrichInspectionTenant(inspection);
        res.json({ success: true, data: enriched });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const createTicket = async (req, res) => {
    try {
        const { id } = req.params;
        const { questionId, questionText, response, notes, priority, category, type, isRequired, blockingStatus, photos } = req.body;

        const inspection = await prisma.inspection.findUnique({
            where: { id: parseInt(id) },
            include: { unit: true, template: true, lease: true }
        });

        if (!inspection) return res.status(404).json({ success: false, message: 'Inspection not found' });

        let ticket;
        try {
            // 1. Create Ticket (Removed 'Maintenance' from logic if any, but mainly pre-filling subject)
            ticket = await prisma.ticket.create({
                data: {
                    userId: inspection.lease?.tenantId || inspection.inspectorId || 1,
                    propertyId: inspection.unit?.propertyId,
                    unitId: inspection.unitId,
                    subject: response ? `${questionText}: ${response}` : questionText,
                    description: `Identified during inspection. Notes: ${notes}`,
                    priority: priority || 'High',
                    category: category || 'MAINTENANCE',
                    type: type || 'REPAIR',
                    status: 'Open',
                    source: inspection.template?.type || 'INSPECTION',
                    isRequired: isRequired !== undefined ? isRequired : true,
                    blockingStatus: blockingStatus || 'NON_BLOCKING',
                    inspectionId: parseInt(id),
                    attachmentUrls: Array.isArray(photos) 
                        ? JSON.stringify(photos.map(url => ({ type: 'image', url })))
                        : (photos ? JSON.stringify([{ type: 'image', url: photos }]) : null)
                }
            });
        } catch (ticketErr) {
            console.error('TICKET_CREATE_ERROR:', ticketErr);
            throw new Error(`Ticket Creation Failed: ${ticketErr.message}`);
        }

        try {
            // 2. Create UnitPrepTask (The Gatekeeper)
            await prisma.unitPrepTask.create({
                data: {
                    unitId: inspection.unitId,
                    bedroomId: inspection.bedroomId,
                    ticketId: ticket.id,
                    title: questionText,
                    description: notes,
                    isRequired: isRequired !== undefined ? isRequired : true,
                    stage: 'PENDING_TICKETS'
                }
            });
        } catch (prepErr) {
            console.error('PREP_TASK_CREATE_ERROR:', prepErr);
            // Non-blocking for now
        }

        try {
            // 3. Update Unit to Blocked status IF ticket is REQUIRED
            if (isRequired !== false) {
                await prisma.unit.update({
                    where: { id: inspection.unitId },
                    data: {
                        status_note: `Blocked - Required Repair Found (${inspection.template?.type || 'INSPECTION'})`,
                        current_stage: 'PENDING_TICKETS'
                    }
                });
            }
        } catch (unitErr) {
            console.error('UNIT_UPDATE_ERROR:', unitErr);
        }

        res.json({ success: true, data: ticket });
    } catch (error) {
        console.error('OVERALL_CREATE_TICKET_ERROR:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

const deleteTicket = async (req, res) => {
    try {
        const { id, ticketId } = req.params;

        await prisma.$transaction(async (tx) => {
            // 1. Delete associated UnitPrepTask
            await tx.unitPrepTask.deleteMany({
                where: { ticketId: parseInt(ticketId) }
            });

            // 2. Delete the Ticket
            const ticket = await tx.ticket.delete({
                where: { id: parseInt(ticketId) }
            });

            // 3. Check if unit should be unblocked (any remaining required tickets?)
            const remainingRequired = await tx.ticket.count({
                where: {
                    unitId: ticket.unitId,
                    status: 'Open',
                    isRequired: true
                }
            });

            if (remainingRequired === 0) {
                await tx.unit.update({
                    where: { id: ticket.unitId },
                    data: {
                        status_note: 'Unblocked - Maintenance Complete',
                        current_stage: 'READY_FOR_CLEANING'
                    }
                });
            }
        });

        res.json({ success: true, message: 'Ticket and associated prep tasks removed.' });
    } catch (error) {
        console.error('DELETE_TICKET_ERROR:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

const deleteInspection = async (req, res) => {
    try {
        const { id } = req.params;

        await prisma.$transaction(async (tx) => {
            // Get inspection details first to identify lease/template
            const inspection = await tx.inspection.findUnique({
                where: { id: parseInt(id) },
                include: { template: true }
            });

            // Delete responses
            await tx.inspectionItemResponse.deleteMany({ where: { inspectionId: parseInt(id) } });
            
            // Delete the inspection
            await tx.inspection.delete({ where: { id: parseInt(id) } });

            // WORKFLOW RESET: If it was a Move-Out related inspection, reset the workflow
            if (inspection && inspection.leaseId && (inspection.template?.type === 'MOVE_OUT' || inspection.template?.type === 'VISUAL')) {
                await tx.moveOut.updateMany({
                    where: { leaseId: inspection.leaseId },
                    data: {
                        status: 'CONFIRMED',
                        visualDate: null,
                        visualTime: null,
                        finalDate: null,
                        finalTime: null,
                        visualInspectionId: null,
                        finalInspectionId: null
                    }
                });
            }
        });

        res.json({ success: true, message: 'Inspection deleted successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    deleteInspection,
    createTemplate,
    getTemplates,
    createInspection,
    submitInspection,
    getInspectionDetails,
    createTicket,
    deleteTicket,
    updateInspection,
    getAllInspections,
    downloadInspectionPDF,
    deleteTemplate,
    duplicateTemplate,
    updateTemplate,
    getResponseSeries,
    createResponseSeries,
    updateResponseSeries,
    deleteResponseSeries,
    uploadInspectionMedia
};

async function updateTemplate(req, res) {
    try {
        const { id } = req.params;
        const { name, type, structure } = req.body;
        const updated = await prisma.inspectionTemplate.update({
            where: { id: parseInt(id) },
            data: { name, type, structure }
        });
        res.json({ success: true, data: updated });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
}

async function deleteTemplate(req, res) {
    try {
        const { id } = req.params;
        await prisma.inspectionTemplate.delete({ where: { id: parseInt(id) } });
        res.json({ success: true, message: 'Template deleted' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
}

async function duplicateTemplate(req, res) {
    try {
        const { id } = req.params;
        const original = await prisma.inspectionTemplate.findUnique({ where: { id: parseInt(id) } });
        if (!original) return res.status(404).json({ success: false, message: 'Not found' });

        const clone = await prisma.inspectionTemplate.create({
            data: {
                name: `${original.name} (Copy)`,
                type: original.type,
                description: original.description,
                structure: original.structure
            }
        });
        res.json({ success: true, data: clone });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
}

async function getResponseSeries(req, res) {
    try {
        const series = await prisma.templateSeries.findMany({
            include: { responses: { orderBy: { order: 'asc' } } }
        });
        res.json({ success: true, data: series });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
}

async function createResponseSeries(req, res) {
    try {
        const { name, description, responses } = req.body;
        if (!name) return res.status(400).json({ success: false, message: 'Group name is required' });

        const responseList = Array.isArray(responses) ? responses : [];

        const series = await prisma.templateSeries.create({
            data: {
                name,
                description,
                responses: {
                    create: responseList.map((r, idx) => ({
                        label: r.label || 'Unnamed Option',
                        color: r.color || 'indigo',
                        order: idx
                    }))
                }
            },
            include: { responses: true }
        });
        res.status(201).json({ success: true, data: series });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
}

async function updateResponseSeries(req, res) {
    try {
        const { id } = req.params;
        const { name, description, responses } = req.body;
        if (!name) return res.status(400).json({ success: false, message: 'Group name is required' });

        const responseList = Array.isArray(responses) ? responses : [];

        const updated = await prisma.$transaction(async (tx) => {
            await tx.templateResponse.deleteMany({ where: { seriesId: parseInt(id) } });
            return await tx.templateSeries.update({
                where: { id: parseInt(id) },
                data: {
                    name,
                    description,
                    responses: {
                        create: responseList.map((r, idx) => ({
                            label: r.label || 'Unnamed Option',
                            color: r.color || 'indigo',
                            order: idx
                        }))
                    }
                },
                include: { responses: true }
            });
        });
        res.json({ success: true, data: updated });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
}

async function deleteResponseSeries(req, res) {
    try {
        const { id } = req.params;
        await prisma.templateSeries.delete({ where: { id: parseInt(id) } });
        res.json({ success: true, message: 'Series deleted' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
}

async function uploadInspectionMedia(req, res) {
    try {
        const { image } = req.body;
        if (!image) return res.status(400).json({ success: false, message: 'No image provided' });
        
        const url = await uploadBase64ToCloudinary(image, 'inspection_photos');
        res.json({ success: true, url });
    } catch (error) {
        console.error('Upload Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
}
