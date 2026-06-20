const cloudinary = require('cloudinary').v2;
const dotenv = require('dotenv');

dotenv.config();

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

async function sign() {
    try {
        const publicId = 'tenant_insurance/iszag1je2pgi8pasw4ua.pdf';
        const url = cloudinary.url(publicId, {
            resource_type: 'image',
            sign_url: true,
            secure: true
        });
        console.log('Signed URL:', url);
    } catch (e) {
        console.error('Error:', e);
    }
}

sign();
