const axios = require('axios');

async function testApi() {
    try {
        // We need a token. Let's try to get one from the DB if possible or just check the endpoint without auth (it will likely fail with 401)
        const baseUrl = 'http://localhost:5000/api';
        console.log(`Testing GET ${baseUrl}/admin/workflow/inspections ...`);
        
        const res = await axios.get(`${baseUrl}/admin/workflow/inspections`).catch(err => err.response);
        
        if (res) {
            console.log('Status:', res.status);
            console.log('Data:', JSON.stringify(res.data, null, 2));
        } else {
            console.log('No response from server.');
        }
    } catch (error) {
        console.error('Error:', error.message);
    }
}

testApi();
