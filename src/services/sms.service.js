const twilio = require("twilio");
const prisma = require("../config/prisma");

// Twilio Credentials
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER;

// Initialize Twilio client
let client;
try {
    client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
} catch (error) {
    console.error("Error initializing Twilio client:", error);
}

/**
 * Helper to ensure E.164 format for US/Canada
 * @param {string} phone 
 * @returns {string} E.164 formatted phone number
 */
const normalizePhoneNumber = (phone) => {
    if (!phone) return phone;

    // 1. Remove all non-numeric characters (parentheses, dashes, spaces)
    const digits = phone.replace(/\D/g, '');

    // 2. Format based on length
    // If 10 digits (e.g. 4165551234), add +1 -> +14165551234
    if (digits.length === 10) {
        return `+1${digits}`;
    }
    // If 11 digits starting with 1 (e.g. 14165551234), add + -> +14165551234
    if (digits.length === 11 && digits.startsWith('1')) {
        return `+${digits}`;
    }

    // Otherwise return original (assumed already correct or international) - ensure it has + if seemingly valid
    return phone.startsWith('+') ? phone : `+${phone}`;
};

/**
 * Send SMS to a phone number
 * @param {string} to - The recipient's phone number (E.164 format e.g., +15550001111)
 * @param {string} message - The message content
 * @returns {Promise<object>} - Twilio message object or error
 */
exports.sendSMS = async (to, message) => {
    if (!client) {
        console.error("Twilio client not initialized");
        return { success: false, message: "Twilio client not initialized" };
    }

    try {
        const formattedTo = normalizePhoneNumber(to);
        console.log(`Sending SMS to ${formattedTo}...`);

        const result = await client.messages.create({
            body: message,
            from: TWILIO_PHONE_NUMBER,
            to: formattedTo,
        });
        console.log(`SMS sent successfully to ${formattedTo}. SID: ${result.sid}`);
        return { success: true, sid: result.sid, result };
    } catch (error) {
        console.error(`Error sending SMS to ${to}:`, error);
        return { success: false, error: error.message, code: error.code };
    }
};

/**
 * Send SMS to multiple phone numbers with batching and campaign tracking
 * @param {Array<object>} recipients - Array of user objects
 * @param {string} templateContent - The raw template content
 * @param {number} campaignId - The ID of the SMSCampaign record
 */
exports.processCampaign = async (recipients, templateContent, campaignId) => {
    try {
        const campaign = await prisma.sMSCampaign.findUnique({ where: { id: campaignId } });
        if (!campaign) throw new Error("Campaign not found");
        
        let successCount = campaign.successCount || 0;
        let failedCount = campaign.failedCount || 0;
        const senderId = campaign.senderId;

        // Update status to PROCESSING
        await prisma.sMSCampaign.update({
            where: { id: campaignId },
            data: { status: 'PROCESSING' }
        });

        for (let i = 0; i < recipients.length; i++) {
            try {
                const user = recipients[i];
                if (!user.phone) {
                    failedCount++;
                    continue;
                }

                const personalizedMessage = exports.parseTemplate(templateContent, user);
                const result = await exports.sendSMS(user.phone, personalizedMessage);

                if (result.success) {
                    successCount++;
                    // Log as a Message for the thread
                    await prisma.message.create({
                        data: {
                            content: personalizedMessage,
                            senderId: senderId,
                            receiverId: user.id,
                            smsSid: result.sid,
                            smsStatus: result.result?.status, // Use status from Twilio result
                            sentVia: 'sms',
                            direction: 'OUTBOUND',
                            isRead: true
                        }
                    });
                } else {
                    failedCount++;
                }

                // Periodically update progress (every 5 messages or at the end)
                if ((i + 1) % 5 === 0 || i === recipients.length - 1) {
                    await prisma.sMSCampaign.update({
                        where: { id: campaignId },
                        data: { 
                            successCount, 
                            failedCount,
                            status: i === recipients.length - 1 ? 'COMPLETED' : 'PROCESSING'
                        }
                    });
                }

                // Throttle to respect Twilio rate limits (1 second between sends)
                if (i < recipients.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            } catch (innerError) {
                console.error(`Error processing recipient ${recipients[i]?.id}:`, innerError);
                failedCount++;
            }
        }
    } catch (fatalError) {
        console.error(`Fatal error in campaign ${campaignId}:`, fatalError);
        await prisma.sMSCampaign.update({
            where: { id: campaignId },
            data: { status: 'FAILED' }
        }).catch(err => console.error("Could not update campaign to failed", err));
    }
};

/**
 * Replace placeholders like {{name}} with actual user data
 */
exports.parseTemplate = (template, user) => {
    if (!template) return '';
    if (!user) return template;

    let message = template;
    const placeholders = {
        'tenantFirstName': user.name?.split(' ')[0] || '',
        'tenantLastName': user.name?.split(' ').slice(1).join(' ') || '',
        'tenantFullName': user.name || '',
        'buildingName': user.building?.name || '',
        'unitNumber': user.unit?.unitNumber || ''
    };

    Object.keys(placeholders).forEach(key => {
        const regex = new RegExp(`{{${key}}}`, 'g');
        message = message.replace(regex, placeholders[key]);
    });

    return message;
};