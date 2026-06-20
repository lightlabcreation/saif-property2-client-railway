const prisma = require('../../config/prisma');
const { uploadToCloudinary } = require('../../config/cloudinary');

const axios = require('axios');

// GET /api/tenant/documents
exports.getDocuments = async (req, res) => {
    try {
        const userId = req.user.id;

        // Fetch documents that are:
        // 1. Directly owned by the tenant (userId = tenantId)
        // 2. Linked to the tenant via DocumentLink (entityType="USER", entityId=tenantId)
        const [directDocuments, linkedDocuments] = await Promise.all([
            // Direct ownership
            prisma.document.findMany({
                where: { userId }
            }),
            // Linked via DocumentLink
            prisma.document.findMany({
                where: {
                    links: {
                        some: {
                            entityType: 'USER',
                            entityId: userId
                        }
                    }
                }
            })
        ]);

        // Combine and deduplicate by document ID
        const allDocumentsMap = new Map();

        directDocuments.forEach(doc => {
            allDocumentsMap.set(doc.id, doc);
        });

        linkedDocuments.forEach(doc => {
            allDocumentsMap.set(doc.id, doc);
        });

        const allDocuments = Array.from(allDocumentsMap.values());

        const token = req.headers.authorization ? req.headers.authorization.split(' ')[1] : '';
        const formatted = allDocuments.map(d => ({
            id: d.id,
            name: d.name,
            type: d.type,
            fileUrl: d.fileUrl.startsWith('http')
                ? `/api/tenant/documents/${d.id}/download?disposition=inline&token=${token}`
                : d.fileUrl,
            date: d.createdAt.toISOString().split('T')[0],
            expiryDate: d.expiryDate ? d.expiryDate.toISOString().split('T')[0] : null
        }));

        // Sort by creation date, newest first
        formatted.sort((a, b) => new Date(b.date) - new Date(a.date));

        res.json(formatted);
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Server error' });
    }
};

// GET /api/tenant/documents/:id
exports.getDocumentById = async (req, res) => {
    try {
        const userId = req.user.id;
        const { id } = req.params;

        // Check if document is owned by tenant OR linked to tenant
        const document = await prisma.document.findFirst({
            where: {
                id: parseInt(id),
                OR: [
                    { userId }, // Direct ownership
                    {
                        links: {
                            some: {
                                entityType: 'USER',
                                entityId: userId
                            }
                        }
                    }
                ]
            }
        });

        if (!document) return res.status(404).json({ message: 'Document not found' });

        const token = req.headers.authorization ? req.headers.authorization.split(' ')[1] : (req.query.token || '');
        const formatted = {
            ...document,
            fileUrl: document.fileUrl.startsWith('http')
                ? `/api/tenant/documents/${document.id}/download?disposition=inline&token=${token}`
                : document.fileUrl
        };

        res.json(formatted);
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Server error' });
    }
};

// GET /api/tenant/documents/:id/download
exports.downloadDocument = async (req, res) => {
    try {
        const userId = req.user.id;
        const { id } = req.params;

        // Check if document is owned by tenant OR linked to tenant
        let document = await prisma.document.findFirst({
            where: {
                id: parseInt(id),
                OR: [
                    { userId }, // Direct ownership
                    { links: { some: { entityType: 'USER', entityId: userId } } }
                ]
            }
        });

        // Fallback: Check if it's attached as their active insurance document
        if (!document) {
            const insuranceCheck = await prisma.insurance.findFirst({
                where: { userId, uploadedDocumentId: parseInt(id) },
                include: { document: true }
            });
            if (insuranceCheck && insuranceCheck.document) {
                document = insuranceCheck.document;
            }
        }

        if (!document || !document.fileUrl) {
            return res.status(404).json({ message: 'Document not found' });
        }

        // Use axios to stream from Cloudinary
        const disposition = req.query.disposition || 'attachment';

        // Set headers for download
        const filename = document.name || 'document';
        const extension = document.fileUrl.split('.').pop().split('?')[0]; // Extract extension from URL, handling queries

        // Ensure filename ends correctly
        const finalFilename = filename.toLowerCase().endsWith(extension.toLowerCase())
            ? filename
            : `${filename}.${extension}`;

        const response = await axios({
            method: 'GET',
            url: document.fileUrl,
            responseType: 'stream',
            headers: {} // Ensure no app headers are leaked
        });

        if (disposition === 'inline') {
            res.setHeader('Content-Disposition', 'inline');
        } else {
            res.setHeader('Content-Disposition', `attachment; filename="${finalFilename}"`);
        }

        // Determine content type more robustly
        let contentType = response.headers['content-type'];
        const urlLower = document.fileUrl ? document.fileUrl.toLowerCase() : '';
        const nameLower = (document.name || '').toLowerCase();

        if (!contentType || contentType === 'application/octet-stream' || contentType.includes('image/') || contentType.includes('text/')) {
            if (urlLower.endsWith('.pdf') || nameLower.endsWith('.pdf')) {
                contentType = 'application/pdf';
            } else if (urlLower.endsWith('.jpg') || urlLower.endsWith('.jpeg') || nameLower.endsWith('.jpg') || nameLower.endsWith('.jpeg')) {
                contentType = 'image/jpeg';
            } else if (urlLower.endsWith('.png') || nameLower.endsWith('.png')) {
                contentType = 'image/png';
            }
        }
        res.setHeader('Content-Type', contentType || 'application/pdf');

        response.data.pipe(res);
    } catch (proxyErr) {
        if (proxyErr.response && proxyErr.response.status === 401 && (document?.fileUrl?.toLowerCase().endsWith('.pdf') || document?.type === 'Insurance')) {
            console.log('Tenant PDF blocked by Cloudinary. Creating image-based PDF fallback...');
            try {
                const PDFDocument = require('pdfkit');
                let fallbackUrl = document.fileUrl;
                
                // Handle raw Cloudinary URLs that don't end in .pdf
                if (fallbackUrl.includes('/raw/upload/')) {
                    fallbackUrl = fallbackUrl.replace('/raw/upload/', '/image/upload/') + '.jpg';
                } else {
                    fallbackUrl = fallbackUrl.replace(/\.pdf$/i, '.jpg');
                }

                const imgResponse = await axios({
                    method: 'GET',
                    url: fallbackUrl,
                    responseType: 'arraybuffer',
                    headers: {}
                });

                res.setHeader('Content-Type', 'application/pdf');
                res.setHeader('Content-Disposition', disposition === 'inline' ? 'inline' : `attachment; filename="${finalFilename.toLowerCase().endsWith('.pdf') ? finalFilename : finalFilename + '.pdf'}"`);

                const pdfDoc = new PDFDocument({ autoFirstPage: false });
                pdfDoc.pipe(res);
                pdfDoc.addPage({ margin: 0 });
                pdfDoc.image(imgResponse.data, 0, 0, { fit: [pdfDoc.page.width, pdfDoc.page.height], align: 'center', valign: 'center' });
                pdfDoc.end();
                return;
            } catch (fbErr) {
                console.error('Tenant PDF Fallback failed:', fbErr.message);
            }
        }
        console.error('Download Error:', proxyErr);
        res.status(500).json({ message: 'Error streaming file' });
    }
};

// POST /api/tenant/documents
exports.uploadDocument = async (req, res) => {
    try {
        const userId = req.user.id;
        const { name, type } = req.body; // Adjusted to match frontend payload

        if (!req.files || !req.files.file) {
            return res.status(400).json({ message: 'No file uploaded' });
        }

        const file = req.files.file;

        // Upload to Cloudinary
        // Note: cloudConfig ensures temp file is deleted after upload
        const isPdf = file.name.toLowerCase().endsWith('.pdf');
        const result = await uploadToCloudinary(file.tempFilePath, 'tenant_documents', {
            resource_type: isPdf ? 'raw' : 'auto'
        });

        const newDoc = await prisma.document.create({
            data: {
                userId,
                name: name || file.name,
                type: type || 'Other',
                fileUrl: result.secure_url,
                expiryDate: null
            }
        });

        res.status(201).json({
            id: newDoc.id,
            name: newDoc.name,
            type: newDoc.type,
            fileUrl: newDoc.fileUrl,
            date: newDoc.createdAt.toISOString().split('T')[0]
        });

    } catch (e) {
        console.error('Document Upload Error:', e);
        res.status(500).json({ message: 'Error uploading document' });
    }
};
