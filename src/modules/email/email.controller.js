const prisma = require('../../config/prisma');
const EmailService = require('../../services/email.service');
const PlaceholderService = require('../../services/placeholder.service');
const axios = require('axios');

/**
 * Convert URL to Base64 String
 */
async function urlToBase64(url) {
    try {
        if (url.startsWith('http')) {
            const response = await axios.get(url, { responseType: 'arraybuffer' });
            return Buffer.from(response.data, 'binary').toString('base64');
        } else {
            // Handle local file
            const fs = require('fs');
            const path = require('path');
            const absolutePath = path.resolve(process.cwd(), url.startsWith('/') ? url.substring(1) : url);
            if (fs.existsSync(absolutePath)) {
                const fileBuffer = fs.readFileSync(absolutePath);
                return fileBuffer.toString('base64');
            }
            return null;
        }
    } catch (error) {
        console.error(`Error converting ${url} to base64:`, error.message);
        return null;
    }
}

// --- TEMPLATES ---

exports.getTemplates = async (req, res) => {
    try {
        const templates = await prisma.emailTemplate.findMany({
            include: { documents: true },
            orderBy: { updatedAt: 'desc' }
        });
        res.json(templates);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.createTemplate = async (req, res) => {
    try {
        const { name, subject, body, documentIds } = req.body;
        const template = await prisma.emailTemplate.create({
            data: {
                name,
                subject,
                body,
                language: req.body.language || 'en',
                type: req.body.type || null,
                documents: documentIds ? { connect: documentIds.map(id => ({ id: parseInt(id) })) } : undefined
            },
            include: { documents: true }
        });
        res.status(201).json(template);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.updateTemplate = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, subject, body, documentIds } = req.body;
        
        // Disconnect all first if documentIds provided
        if (documentIds) {
            await prisma.emailTemplate.update({
                where: { id: parseInt(id) },
                data: { documents: { set: [] } }
            });
        }

        const template = await prisma.emailTemplate.update({
            where: { id: parseInt(id) },
            data: {
                name,
                subject,
                body,
                language: req.body.language,
                type: req.body.type,
                documents: documentIds ? { connect: documentIds.map(id => ({ id: parseInt(id) })) } : undefined
            },
            include: { documents: true }
        });
        res.json(template);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.deleteTemplate = async (req, res) => {
    try {
        const { id } = req.params;
        await prisma.emailTemplate.delete({ where: { id: parseInt(id) } });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// --- SENDING ---

exports.sendBulkEmails = async (req, res) => {
    try {
        const { recipientIds, recipients, templateId, customSubject, customBody, manualAttachmentIds } = req.body;
        
        if ((!recipientIds || recipientIds.length === 0) && (!recipients || recipients.length === 0)) {
            return res.status(400).json({ error: 'Recipients are required' });
        }

        let template = null;
        if (templateId) {
            template = await prisma.emailTemplate.findUnique({
                where: { id: parseInt(templateId) },
                include: { documents: true }
            });
        }

        // Prepare attachments
        const allAttIds = [...(template?.documents.map(d => d.id) || []), ...(manualAttachmentIds || [])];
        const uniqueAttIds = [...new Set(allAttIds)];
        const docs = await prisma.document.findMany({
            where: { id: { in: uniqueAttIds.map(id => parseInt(id)) } }
        });

        const preparedAttachments = await Promise.all(docs.map(async doc => {
            const base64 = await urlToBase64(doc.fileUrl);
            if (!base64) return null;
            return {
                content: base64,
                filename: doc.name,
                type: 'application/pdf' // Defaulting to PDF, but could be dynamic
            };
        }));
        const cleanedAttachments = preparedAttachments.filter(a => a !== null);

        const results = { success: 0, failed: 0, errors: [] };

        // Process each recipient individually for privacy and personalization
        const targetRecipients = recipients || (recipientIds || []).map(id => ({ id }));
        
        for (const recipient of targetRecipients) {
            try {
                const rId = recipient.id;
                const propId = recipient.propertyId;
                
                const user = await prisma.user.findUnique({ where: { id: parseInt(rId) } });
                if (!user || !user.email) {
                    results.failed++;
                    results.errors.push(`User ${rId} has no email`);
                    continue;
                }
    
                const placeholderData = await PlaceholderService.getPlaceholderData(user.id, propId);
                
                const finalSubject = PlaceholderService.resolve(customSubject || template?.subject || '', placeholderData);
                const finalBody = PlaceholderService.resolve(customBody || template?.body || '', placeholderData);
    
                const sendResult = await EmailService.sendEmail(user.email, finalSubject, finalBody, {
                    recipientId: user.id,
                    templateId: template?.id,
                    eventType: template ? `TEMPLATE_${template.name.toUpperCase().replace(/\s+/g, '_')}` : 'MANUAL_BULK',
                    attachments: cleanedAttachments,
                    attachmentIds: uniqueAttIds, // Store links in DB
                    isHtml: true,
                    buildingId: propId ? parseInt(propId) : null 
                });
    
                if (sendResult.success) {
                    results.success++;
                } else {
                    results.failed++;
                    results.errors.push(`Error for ${user.email}: ${sendResult.error}`);
                }
            } catch (err) {
                results.failed++;
                results.errors.push(`Unexpected error for recipient object: ${err.message}`);
            }
        }

        res.json({ message: 'Bulk send completed', results });
    } catch (error) {
        console.error('Bulk Send Error:', error);
        res.status(500).json({ error: error.message });
    }
};

// --- HISTORY & SIGNATURE ---

exports.getHistory = async (req, res) => {
    try {
        const { startDate, endDate, tenantName, buildingId, subject, templateId } = req.query;

        const where = {
            channel: 'Email'
        };

        if (startDate && endDate) {
            where.timestamp = {
                gte: new Date(startDate),
                lte: new Date(endDate)
            };
        }

        if (tenantName) {
            where.recipientUser = {
                name: { contains: tenantName }
            };
        }

        if (buildingId) {
            where.entityId = parseInt(buildingId);
        }

        if (subject) {
            where.subject = { contains: subject };
        }

        if (templateId) {
            where.templateId = parseInt(templateId);
        }

        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        const [logs, totalCount] = await Promise.all([
            prisma.communicationLog.findMany({
                where,
                include: {
                    recipientUser: { select: { id: true, name: true, email: true, buildingId: true } },
                    emailTemplate: { select: { id: true, name: true } }
                },
                orderBy: { timestamp: 'desc' },
                skip,
                take: limit
            }),
            prisma.communicationLog.count({ where })
        ]);

        res.json({
            data: logs,
            pagination: {
                total: totalCount,
                page,
                limit,
                totalPages: Math.ceil(totalCount / limit)
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.getSignature = async (req, res) => {
    try {
        const setting = await prisma.systemSetting.findUnique({
            where: { key: 'GLOBAL_EMAIL_SIGNATURE' }
        });
        res.json({ signature: setting ? setting.value : '' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.updateSignature = async (req, res) => {
    try {
        const { signature } = req.body;
        const setting = await prisma.systemSetting.upsert({
            where: { key: 'GLOBAL_EMAIL_SIGNATURE' },
            update: { value: signature },
            create: { key: 'GLOBAL_EMAIL_SIGNATURE', value: signature }
        });
        res.json({ success: true, setting });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

/**
 * Resend an Email from Log
 */
exports.resendEmail = async (req, res) => {
    try {
        const { id } = req.params;
        const log = await prisma.communicationLog.findUnique({
            where: { id: parseInt(id) }
        });

        if (!log) {
            return res.status(404).json({ error: 'Log not found' });
        }

        // Use the exactly stored content and subject, but bypass signature re-appending 
        // because it's already in the content from previous send call.
        const sendResult = await EmailService.sendEmail(log.recipient, log.subject, log.content, {
            recipientId: log.recipientId,
            templateId: log.templateId,
            eventType: `RESEND_${log.eventType}`,
            attachments: [], 
            isHtml: true,
            skipSignature: true
        });

        if (sendResult.success) {
            res.json({ success: true, message: 'Resent successfully' });
        } else {
            res.status(500).json({ success: false, error: sendResult.error });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

/**
 * Get Single Log Details
 */
exports.getLogDetails = async (req, res) => {
    try {
        const { id } = req.params;
        const log = await prisma.communicationLog.findUnique({
            where: { id: parseInt(id) },
            include: {
                recipientUser: { select: { id: true, name: true, email: true } },
                emailTemplate: {
                    include: { documents: true }
                }
            }
        });
        if (!log) return res.status(404).json({ error: 'Log not found' });

        // Manually fetch associated document links for manual attachments or specific overrides
        let docLinks = await prisma.documentLink.findMany({
            where: {
                entityType: 'CommunicationLog',
                entityId: parseInt(id)
            },
            include: { document: true }
        });

        let attachments = docLinks.map(l => l.document);

        // Fallback for older logs or template-driven emails: merge in template documents
        if (attachments.length === 0 && log.emailTemplate?.documents) {
            attachments = log.emailTemplate.documents;
        }

        res.json({ ...log, attachments });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};
