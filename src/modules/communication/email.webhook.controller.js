const prisma = require('../../config/prisma');

/**
 * Webhook Handler for Incoming Emails
 * E.g. SendGrid Inbound Parse
 */
exports.handleIncomingEmail = async (req, res) => {
    try {
        // SendGrid sends data as multipart/form-data. The fields include 'from', 'text', 'subject', etc.
        // For this example, we assume middleware like multer is used if needed, or req.body contains the fields.
        const fromHeader = req.body.from || '';
        const textBody = req.body.text || req.body.html || '';
        const subject = req.body.subject || 'Incoming Reply';

        // Extract email address from 'from' string (e.g. "John Doe <john@example.com>")
        const emailMatch = fromHeader.match(/<([^>]+)>/);
        const fromEmail = emailMatch ? emailMatch[1].toLowerCase() : fromHeader.trim().toLowerCase();

        if (!fromEmail) {
            console.error('❌ Missing From email in webhook');
            return res.status(400).send('Missing From email');
        }

        console.log(`📧 Incoming Email from: ${fromEmail}`);

        // Find tenant by email
        const user = await prisma.user.findFirst({
            where: { email: fromEmail, isActive: true },
            orderBy: { createdAt: 'desc' }
        });

        if (!user) {
            console.warn(`⚠️ Webhook Match Failed! No active user found matching: ${fromEmail}`);
            // Return 200 so the webhook provider doesn't retry
            return res.status(200).send('User not found, but webhook received.');
        }

        // Create a CommunicationLog for this incoming email
        const log = await prisma.communicationLog.create({
            data: {
                channel: 'Email',
                eventType: 'INBOUND_EMAIL',
                recipient: user.email,
                recipientId: user.id,
                content: textBody,
                subject: subject,
                status: 'Received',
                timestamp: new Date()
            }
        });

        console.log(`✅ Email from ${user.name} saved to CommunicationLog (ID: ${log.id})`);
        res.status(200).send('OK');

    } catch (error) {
        console.error('❌ Error handling incoming email:', error);
        res.status(500).send('Error processing webhook');
    }
};
