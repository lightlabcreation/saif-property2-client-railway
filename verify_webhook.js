const axios = require('axios');

// Using the local server if running, or the Railway URL if the user wants to test production.
// For verification, I'll assume we can test against the local environment if it's running, 
// OR I can just run the logic directly in a script.

// Better: Let's run a script that imports the logic and tests it against the database.
const { handleIncomingSMS } = require('./src/modules/communication/twilio.webhook.controller');
const prisma = require('./src/config/prisma');

async function test() {
    console.log('--- Simulating Inbound SMS ---');
    
    // 1. Pick a user with a phone number for testing
    const testUser = await prisma.user.findFirst({
        where: { NOT: { phone: null }, phone: { not: '' } }
    });

    if (!testUser) {
        console.error('No users with phone numbers found in DB to test with.');
        return;
    }

    console.log(`Using test user: ${testUser.name} (${testUser.phone})`);

    // 2. Prepare mock req/res
    const req = {
        body: {
            From: testUser.phone.startsWith('+') ? testUser.phone : `+1${testUser.phone.replace(/\D/g, '')}`,
            To: '+11234567890',
            Body: 'Test reply from Clint',
            MessageSid: 'SM' + Math.random().toString(36).substring(7)
        }
    };

    const res = {
        set: (key, val) => console.log(`Header: ${key} = ${val}`),
        send: (content) => {
            console.log('Response sent to Twilio:');
            console.log(content);
        }
    };

    // 3. Run the handler
    try {
        await handleIncomingSMS(req, res);
        
        // 4. Verify message was created
        const savedMessage = await prisma.message.findFirst({
            where: { smsSid: req.body.MessageSid },
            include: { sender: true, receiver: true }
        });

        if (savedMessage) {
            console.log('✅ Message successfully saved to DB!');
            console.log(`From: ${savedMessage.sender.name}`);
            console.log(`Content: ${savedMessage.content}`);
            console.log(`Direction: ${savedMessage.direction}`);
        } else {
            console.error('❌ Message was NOT found in DB after handler execution.');
        }
    } catch (err) {
        console.error('❌ Error during test:', err);
    } finally {
        await prisma.$disconnect();
    }
}

test();
