const PDFDocument = require('pdfkit');
const fs = require('fs');
const axios = require('axios');

async function debugFallback() {
    try {
        const fallbackUrl = 'https://res.cloudinary.com/dw48hcxi5/image/upload/v1773473001/tenant_insurance/iszag1je2pgi8pasw4ua.jpg';
        
        console.log('Fetching JPG...');
        const response = await axios({
            method: 'GET',
            url: fallbackUrl,
            responseType: 'arraybuffer',
            headers: {}
        });

        console.log('JPG response status:', response.status);
        console.log('Data length:', response.data.length);
        console.log('Is Buffer:', Buffer.isBuffer(response.data));

        console.log('Creating PDF...');
        const pdfDoc = new PDFDocument({ autoFirstPage: false });
        const stream = fs.createWriteStream('c:/Users/Admin/Desktop/property_lightlab/backend/debug_fallback.pdf');
        
        pdfDoc.pipe(stream);
        pdfDoc.addPage({ margin: 0 });
        pdfDoc.image(response.data, 0, 0, { fit: [pdfDoc.page.width, pdfDoc.page.height], align: 'center', valign: 'center' });
        pdfDoc.end();

        stream.on('finish', () => {
            console.log('PDF Created successfully! Size:', fs.statSync('c:/Users/Admin/Desktop/property_lightlab/backend/debug_fallback.pdf').size);
        });

    } catch (e) {
        console.error('Error:', e);
    }
}

debugFallback();
