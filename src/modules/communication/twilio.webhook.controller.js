const prisma = require("../../config/prisma");

/**
 * Twilio Webhook Handler for Incoming SMS
 * This endpoint receives incoming SMS messages from Twilio and creates them in the database
 */
exports.handleIncomingSMS = async (req, res) => {
    try {
        const { From, To, Body, MessageSid } = req.body;

        console.log('📱 Incoming SMS from Twilio:', { From, To, Body, MessageSid });

        if (!From) {
            console.error('❌ Missing From number in Twilio webhook');
            return res.status(400).send('Missing From number');
        }

        // 2. Find sender by phone number (Prioritize primary roles: Tenant/Owner)
        const cleanFrom = From.replace(/\D/g, '').slice(-10);
        console.log(`🔍 Webhook Incoming: "${From}" -> Pattern: "%${cleanFrom}"`);

        const users = await prisma.user.findMany({
            where: { phone: { contains: cleanFrom } },
            orderBy: [
                { role: 'asc' },   // Sort roles: ADMIN < COWORKER < OWNER < TENANT (alphabetical)
                { createdAt: 'desc' }
            ]
        });

        // Smart Match: Prefer Active Tenant/Owner > Active Other > Anyone else
        let sender = users.find(u => u.isActive && (u.role === 'TENANT' || u.role === 'OWNER')) 
                  || users.find(u => u.isActive)
                  || users[0];

        if (!sender) {
            console.warn(`⚠️ Webhook Match Failed! No user found matching: ${cleanFrom}`);
            res.set('Content-Type', 'text/xml');
            return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Message>Sorry, we couldn't identify your account. Please contact your property manager.</Message>
</Response>`);
        }

        console.log(`✅ Webhook Matched: ${sender.name} (ID: ${sender.id}, Role: ${sender.role})`);

        // Find which admin to assign this to. 
        // Strategy: Find the last interaction (sent or received) between any staff and this sender.
        // Fallback: Use the first admin found in the system.
        const lastInteraction = await prisma.message.findFirst({
            where: {
                OR: [
                    { senderId: sender.id, receiver: { role: { in: ['ADMIN', 'COWORKER'] } } },
                    { receiverId: sender.id, sender: { role: { in: ['ADMIN', 'COWORKER'] } } }
                ]
            },
            orderBy: { createdAt: 'desc' },
            select: { 
                senderId: true, 
                receiverId: true,
                sender: { select: { role: true } },
                receiver: { select: { role: true } }
            }
        });

        let assignedAdminId;
        if (lastInteraction) {
            assignedAdminId = ['ADMIN', 'COWORKER'].includes(lastInteraction.sender?.role) 
                ? lastInteraction.senderId 
                : lastInteraction.receiverId;
        } else {
            const firstAdmin = await prisma.user.findFirst({
                where: { role: 'ADMIN' }
            });
            assignedAdminId = firstAdmin ? firstAdmin.id : null;
        }

        if (!assignedAdminId) {
            console.error('❌ No admin user found to receive incoming SMS');
            res.set('Content-Type', 'text/xml');
            return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Message>System error. Please try again later.</Message>
</Response>`);
        }

        // Create message in database
        const message = await prisma.message.create({
            data: {
                content: Body,
                senderId: sender.id,
                receiverId: assignedAdminId,
                isRead: false,
                smsSid: MessageSid,
                smsStatus: 'received',
                sentVia: 'sms', // Incoming is always via SMS
                direction: 'INBOUND',
                isReadByAdmin: false
            }
        });

        console.log(`✅ SMS from ${sender.name} saved to database (ID: ${message.id}, Assigned to Admin: ${assignedAdminId})`);

        // Send TwiML response (optional auto-reply)
        res.set('Content-Type', 'text/xml');
        // If it's a resident, maybe different auto-reply? 
        // For now, keep it simple but friendly.
        res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
</Response>`); // Empty response means no auto-reply (cleaner for users)

    } catch (error) {
        console.error('❌ Error handling incoming SMS:', error);
        res.set('Content-Type', 'text/xml');
        res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Message>Error processing your message. Please try again.</Message>
</Response>`);
    }
};


/**
 * Twilio Status Callback Handler
 * Updates SMS delivery status in the database
 */
exports.handleSMSStatusCallback = async (req, res) => {
    try {
        const { MessageSid, MessageStatus } = req.body;

        console.log('📊 SMS Status Update:', { MessageSid, MessageStatus });

        // Update message status in database
        const updated = await prisma.message.updateMany({
            where: { smsSid: MessageSid },
            data: { smsStatus: MessageStatus }
        });

        console.log(`✅ Updated ${updated.count} message(s) with status: ${MessageStatus}`);

        res.sendStatus(200);
    } catch (error) {
        console.error('❌ Error handling SMS status callback:', error);
        res.sendStatus(500);
    }
};