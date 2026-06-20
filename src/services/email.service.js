const axios = require('axios');
const prisma = require('../config/prisma');

/**
 * Email Service
 * Handles sending emails via SendGrid REST API
 */
class EmailService {
    /**
     * Send an email using SendGrid
     * @param {string} to - Recipient email address
     * @param {string} subject - Email subject
     * @param {string} content - Email body (HTML or plain text)
     * @param {object} [options] - Optional. { eventType, templateId, attachments, isHtml = true, recipientId }
     * @returns {Promise<object>} - SendGrid response or error
     */
    static async sendEmail(to, subject, content, options = {}) {
        const eventType = options.eventType || 'MANUAL_EMAIL';
        const isHtml = options.isHtml !== false;
        const recipientId = options.recipientId || null;
        const templateId = options.templateId || null;
        const attachments = options.attachments || []; // [{ content, filename, type }]

        if (!process.env.SENDGRID_API_KEY) {
            console.error('[EmailService] SENDGRID_API_KEY is not defined in .env');
            return { success: false, error: 'API Key missing' };
        }

        try {
            // Fetch sender name from SystemSettings if exists
            const settings = await prisma.systemSetting.findUnique({
                where: { key: 'EMAIL_SENDER_NAME' }
            });
            const signatureSetting = await prisma.systemSetting.findUnique({
                where: { key: 'GLOBAL_EMAIL_SIGNATURE' }
            });

            const senderName = settings ? settings.value : 'Campus Habitations';
            const fromEmail = process.env.SENDGRID_SENDER_EMAIL || 'Administration@campushabitations.com';
            const globalSignature = (signatureSetting && !options.skipSignature) ? signatureSetting.value : '';

            // Append signature if it's HTML and not skipped
            const finalBody = isHtml ? `${content}${globalSignature ? `<br/><br/>${globalSignature}` : ''}` : `${content}${globalSignature ? `\n\n${globalSignature.replace(/<[^>]*>?/gm, '')}` : ''}`;

            const data = {
                personalizations: [{
                    to: [{ email: to }]
                }],
                from: {
                    email: fromEmail,
                    name: senderName
                },
                subject: subject,
                content: [{
                    type: isHtml ? 'text/html' : 'text/plain',
                    value: finalBody
                }]
            };

            if (attachments.length > 0) {
                data.attachments = attachments.map(att => ({
                    content: att.content, // base64
                    filename: att.filename,
                    type: att.type,
                    disposition: 'attachment'
                }));
            }

            const response = await axios.post('https://api.sendgrid.com/v3/mail/send', data, {
                headers: {
                    'Authorization': `Bearer ${process.env.SENDGRID_API_KEY}`,
                    'Content-Type': 'application/json'
                }
            });

            // Log to CommunicationLog
            const logEntry = await prisma.communicationLog.create({
                data: {
                    channel: 'Email',
                    eventType,
                    recipient: to,
                    recipientId: recipientId ? parseInt(recipientId) : null,
                    subject: subject,
                    content: finalBody,
                    status: 'Sent',
                    templateId: templateId ? parseInt(templateId) : null,
                    hasAttachments: attachments.length > 0,
                    relatedEntity: options.buildingId ? 'Property' : null,
                    entityId: options.buildingId ? parseInt(options.buildingId) : null
                }
            });

            // If there are specific document IDs, link them to the log for "history viewing"
            if (options.attachmentIds && options.attachmentIds.length > 0) {
                await Promise.all(options.attachmentIds.map(docId => 
                    prisma.documentLink.create({
                        data: {
                            documentId: parseInt(docId),
                            entityType: 'CommunicationLog',
                            entityId: logEntry.id
                        }
                    })
                ));
            }

            return { success: true, status: response.status };
        } catch (error) {
            const errorMessage = error.response ? JSON.stringify(error.response.data) : error.message;
            console.error(`[EmailService] Error sending email to ${to}:`, errorMessage);

            try {
                await prisma.communicationLog.create({
                    data: {
                        channel: 'Email',
                        eventType,
                        recipient: to,
                        recipientId: recipientId ? parseInt(recipientId) : null,
                        subject: subject,
                        content: content,
                        status: 'Failed',
                        templateId: templateId ? parseInt(templateId) : null,
                        hasAttachments: attachments.length > 0
                    }
                });
            } catch (logError) {
                // ignore
            }

            return { success: false, error: errorMessage };
        }
    }
}

module.exports = EmailService;
