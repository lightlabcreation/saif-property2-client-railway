const prisma = require('../../config/prisma');
const https = require('https');
const { uploadToCloudinary } = require('../../config/cloudinary');

// GET /api/admin/tickets
exports.getAllTickets = async (req, res) => {
    try {
        const { userId } = req.query;

        const where = {};
        if (userId) {
            where.userId = parseInt(userId);
        }

        const tickets = await prisma.ticket.findMany({
            where,
            include: {
                user: true,
                unit: { include: { property: true } },
                property: true,
                inspection: { include: { inspector: true } }
            },
            orderBy: { createdAt: 'desc' }
        });

        const formatted = tickets.map(t => {
            // Priority 1: Direct unit link from ticket (for Move-Out/In deficiency)
            // Priority 2: Active lease unit
            let unitInfo = 'No Active Unit';
            if (t.unit) {
                unitInfo = `${t.unit.property.name} - ${t.unit.unitNumber}`;
            }

            return {
                id: `T-${t.id + 1000}`,
                dbId: t.id,
                tenant: t.user.name || 'Unknown',
                userRole: t.user.role,
                inspectorName: t.inspection?.inspector?.name || 'N/A',
                unit: unitInfo,
                subject: t.subject,
                category: t.category,
                priority: t.priority,
                status: t.status,
                desc: t.description,
                createdAt: t.createdAt.toLocaleString(),
                createdAtRaw: t.createdAt.toISOString(),
                date: t.createdAt.toISOString().split('T')[0],
                resolvedAt: t.resolvedAt ? t.resolvedAt.toISOString() : null,
                attachments: (() => {
                    try {
                        return t.attachmentUrls ? JSON.parse(t.attachmentUrls) : [];
                    } catch (e) {
                        return [];
                    }
                })(),
                tenantDetails: {
                    name: t.user.name,
                    property: t.unit?.property?.name || 'N/A',
                    unit: t.unit?.unitNumber || 'N/A',
                    leaseStatus: 'N/A',
                    email: t.user.email,
                    phone: t.user.phone,
                },
                propertyId: t.propertyId,
                unitId: t.unitId,
                tenantId: t.userId,
                isRequired: t.isRequired
            };
        });

        res.json(formatted);
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Server error' });
    }
};

const workflowService = require('../../services/workflow.service');

// PUT /api/admin/tickets/:id/status
exports.updateTicketStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        const ticketId = parseInt(id);

        const updated = await prisma.ticket.update({
            where: { id: ticketId },
            data: { 
                status,
                resolvedAt: status === 'Resolved' ? new Date() : null
            }
        });

        // Trigger Auto-Progression for Unit Prep Flow if applicable
        if (updated.unitId && ['Closed', 'Completed', 'Resolved'].includes(status)) {
            await workflowService.checkAndProgressUnitPrep(updated.unitId);
        }

        res.json(updated);
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Server error' });
    }
};

// POST /api/admin/tickets (Admin creating ticket for tenant)
exports.createTicket = async (req, res) => {
    try {
        const { tenantId, subject, description, priority, category, unitId } = req.body;
        let { propertyId } = req.body;

        const attachmentUrls = [];

        // Handle Images upload
        if (req.files && req.files.images) {
            const images = Array.isArray(req.files.images) ? req.files.images : [req.files.images];
            for (const img of images) {
                const result = await uploadToCloudinary(img.tempFilePath, 'tickets/images');
                attachmentUrls.push({ type: 'image', url: result.secure_url });
            }
        }

        // Handle Video upload
        if (req.files && req.files.video) {
            const video = req.files.video;
            const result = await uploadToCloudinary(video.tempFilePath, 'tickets/videos');
            attachmentUrls.push({ type: 'video', url: result.secure_url });
        }

        // 1. Resolve Target Property IDs
        let targetPropertyIds = [];
        if (propertyId === 'all') {
            const allProps = await prisma.property.findMany({ select: { id: true } });
            targetPropertyIds = allProps.map(p => p.id);
        } else if (propertyId) {
            // Handle comma-separated list of IDs for multi-select (e.g., "1,2,3")
            targetPropertyIds = propertyId.toString().split(',').map(id => parseInt(id.trim())).filter(Boolean);
        }

        if (targetPropertyIds.length === 0) {
            targetPropertyIds = [null]; // Fallback to generic
        }

        // 2. Resolve Fallback Assignment User
        let assignId = parseInt(tenantId);
        if (!assignId) {
            const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
            assignId = admin ? admin.id : 1; 
        }

        const createdTickets = [];
        for (const pid of targetPropertyIds) {
            const ticket = await prisma.ticket.create({
                data: {
                    userId: assignId,
                    subject,
                    description,
                    priority,
                    category: category || null,
                    status: 'Open',
                    propertyId: pid,
                    unitId: pid ? (unitId ? parseInt(unitId) : null) : null, // Units only apply if 1 property selected usually
                    attachmentUrls: attachmentUrls.length > 0 ? JSON.stringify(attachmentUrls) : null
                }
            });
            createdTickets.push(ticket);
        }

        // Return first or summary
        res.status(201).json(targetPropertyIds.length === 1 ? createdTickets[0] : { success: true, count: createdTickets.length });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Error creating ticket' });
    }
};

// PUT /api/admin/tickets/:id
exports.updateTicket = async (req, res) => {
    try {
        const { id } = req.params;
        const { subject, description, priority, category, status, propertyId, unitId, tenantId } = req.body;

        const updateData = {
            subject,
            description,
            priority,
            category,
            status,
            propertyId: propertyId ? parseInt(propertyId) : undefined,
            unitId: unitId ? parseInt(unitId) : undefined,
            userId: tenantId ? parseInt(tenantId) : undefined
        };

        if (status !== undefined) {
            updateData.resolvedAt = status === 'Resolved' ? new Date() : null;
        }

        const updated = await prisma.ticket.update({
            where: { id: parseInt(id) },
            data: updateData
        });

        // Trigger Auto-Progression for Unit Prep Flow if applicable
        if (updated.unitId && status && ['Closed', 'Completed', 'Resolved'].includes(status)) {
            await workflowService.checkAndProgressUnitPrep(updated.unitId);
        }

        res.json(updated);
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Error updating ticket' });
    }
};

// DELETE /api/admin/tickets/:id
exports.deleteTicket = async (req, res) => {
    try {
        const { id } = req.params;
        await prisma.ticket.delete({
            where: { id: parseInt(id) }
        });
        res.json({ message: 'Ticket deleted' });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Error deleting ticket' });
    }
};

// GET /api/admin/tickets/:ticketId/attachments/:attachmentId
exports.getTicketAttachment = async (req, res) => {
    try {
        const { ticketId, attachmentId } = req.params;
        const ticket = await prisma.ticket.findUnique({
            where: { id: parseInt(ticketId) }
        });

        if (!ticket || !ticket.attachmentUrls) {
            return res.status(404).json({ message: 'Attachment not found' });
        }

        let attachments;
        try {
            attachments = JSON.parse(ticket.attachmentUrls);
        } catch (e) {
            return res.status(500).json({ message: 'Corrupted attachment data' });
        }
        const attachment = attachments[parseInt(attachmentId)];

        if (!attachment || !attachment.url) {
            return res.status(404).json({ message: 'Attachment not found' });
        }

        // Proxy the file from Cloudinary 
        https.get(attachment.url, (response) => {
            if (response.statusCode !== 200) {
                return res.status(response.statusCode).json({ message: 'Failed to fetch attachment from storage' });
            }

            // Trust Cloudinary's content type or guess based on type
            const contentType = response.headers['content-type'] || (attachment.type === 'image' ? 'image/jpeg' : 'application/octet-stream');

            res.setHeader('Content-Type', contentType);
            res.setHeader('Content-Length', response.headers['content-length']);
            // Force inline display for previewable types
            res.setHeader('Content-Disposition', 'inline');

            response.pipe(res);
        }).on('error', (err) => {
            console.error('Attachment Proxy Error:', err);
            res.status(500).json({ message: 'Error proxying attachment' });
        });

    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Server error' });
    }
};
