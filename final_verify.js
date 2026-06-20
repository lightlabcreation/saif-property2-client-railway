const { PrismaClient } = require('@prisma/client');
const axios = require('axios');
const qs = require('querystring');
const prisma = new PrismaClient();

async function runFullTest() {
    try {
        console.log('--- Phase 1: Finding a User with a Phone Number ---');
        const user = await prisma.user.findFirst({
            where: {
                NOT: { phone: null },
                phone: { not: '' }
            }
        });

        if (!user) {
            console.log('❌ No user found with a phone number in the local database. Please add one first.');
            return;
        }

        console.log(`✅ Found user: ${user.name} (${user.phone})`);
        const phoneToTest = user.phone.replace(/\D/g, '').slice(-10);

        console.log('\n--- Phase 2: Sending Mock Webhook to http://localhost:5000 ---');
        const url = 'http://localhost:5000/api/webhooks/twilio/sms/incoming';
        const payload = {
            From: '+1' + phoneToTest, // Simulated Twilio format
            To: '+14388010131',
            Body: 'SYSTEM_VERIFICATION_TEST_' + Math.random().toString(36).substring(7),
            MessageSid: 'SM_VERIFY_' + Date.now()
        };

        const response = await axios.post(url, qs.stringify(payload), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        console.log('Status Code:', response.status);
        console.log('Server Response Body:', response.data);
        
        console.log('\n--- Phase 3: Verifying Database Entry ---');
        // Wait a small bit for DB to catch up if needed
        await new Promise(r => setTimeout(r, 1000));
        
        const message = await prisma.message.findFirst({
            where: { content: payload.Body },
            include: { sender: true, receiver: true }
        });

        if (message) {
            console.log('✅ PASS: Message was found in the database!');
            console.log(`- Sender: ${message.sender.name}`);
            console.log(`- Receiver (Admin): ${message.receiver?.name || 'Unknown'}`);
            console.log(`- Content: ${message.content}`);
        } else {
            console.log('❌ FAIL: Message was not found in the database.');
        }

    } catch (error) {
        console.error('❌ Error during test:', error.message);
        if (error.response) console.error('Response:', error.response.data);
    } finally {
        await prisma.$disconnect();
    }
}

runFullTest();
