const PDFDocument = require('pdfkit');
const axios = require('axios');
const path = require('path');

/**
 * Generates an Invoice PDF
 * @param {Object} invoice - Invoice object from DB
 * @param {Object} res - Express response object
 * @param {Object} settings - System settings for branding
 */
/**
 * Generates an Invoice PDF
 * @param {Object} invoice - Invoice object from DB (enriched with relations)
 * @param {Object} res - Express response object
 * @param {Object} settings - System settings for branding
 */
const generateInvoicePDF = (invoice, res, settings = {}) => {
    const doc = new PDFDocument({
        margin: 50,
        size: 'A4',
        bufferPages: true
    });

    // Set Response Headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=invoice-${invoice.invoiceNo}.pdf`);

    doc.pipe(res);

    // --- HELPER: Colors & Styles ---
    const colors = {
        primary: '#4f46e5', // Indigo 600
        secondary: '#64748b', // Slate 500
        text: '#1e293b', // Slate 800
        lightText: '#94a3b8', // Slate 400
        border: '#e2e8f0', // Slate 200
        accent: '#f8fafc' // Slate 50
    };

    // --- HEADER SECTION ---
    const logoPath = path.join(__dirname, '..', 'assets', 'logo.png');
    try {
        doc.image(logoPath, 50, 45, { width: 140 });
        // Precise masking of the sub-text area under the "MASTEKO" name
        doc.save(); // Save state
        doc.rect(50, 70, 150, 40).fill('#ffffff');
        doc.restore(); // Restore state
    } catch (e) {
        doc.fontSize(24).fillColor(colors.primary).font('Helvetica-Bold').text('MASTEKO', 50, 50);
    }

    // Header info removed at user request (Company details and taglines)

    doc.moveTo(50, 115).lineTo(550, 115).strokeColor(colors.border).lineWidth(1).stroke();

    // --- INVOICE TITLE & INFO ---
    doc.fillColor(colors.text).font('Helvetica-Bold').fontSize(22).text('INVOICE', 50, 140);

    // Status Badge removed at user request (e.g. "SENT")

    // Invoice Meta (right aligned)
    let metaY = 175;
    const drawMeta = (label, value) => {
        doc.fillColor(colors.secondary).font('Helvetica-Bold').fontSize(10).text(label, 350, metaY);
        doc.fillColor(colors.text).font('Helvetica').fontSize(10).text(value, 460, metaY, { align: 'right', width: 90 });
        metaY += 18;
    };

    drawMeta('Invoice Number:', invoice.invoiceNo);
    drawMeta('Invoice Date:', new Date(invoice.createdAt || Date.now()).toLocaleDateString());
    drawMeta('Billing Period:', invoice.month || 'N/A');
    drawMeta('Due Date:', invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString() : 'Upon Receipt');

    // --- BILLING DETAILS SECTION ---
    doc.moveTo(50, 260).lineTo(550, 260).strokeColor(colors.border).lineWidth(0.5).stroke();

    // Billed To
    doc.fillColor(colors.primary).font('Helvetica-Bold').fontSize(12).text('BILLED TO', 50, 280);
    doc.fillColor(colors.text).font('Helvetica-Bold').fontSize(11).text(invoice.tenant?.name || 'Valued Tenant', 50, 300);
    doc.fillColor(colors.secondary).font('Helvetica').fontSize(9).text(invoice.tenant?.email || '', 50, 314);
    doc.text(invoice.tenant?.phone || '', 50, 326);

    // Property Details
    doc.fillColor(colors.primary).font('Helvetica-Bold').fontSize(12).text('PROPERTY DETAILS', 300, 280);
    doc.fillColor(colors.text).font('Helvetica-Bold').fontSize(10).text(invoice.unit?.property?.name || 'N/A', 300, 300);
    doc.font('Helvetica').fontSize(9).fillColor(colors.secondary);
    doc.text(`Unit: ${invoice.unit?.name || 'N/A'}`, 300, 314);

    // Bedroom details if applicable
    if (invoice.lease?.bedroom) {
        doc.text(`Bedroom: ${invoice.lease.bedroom.bedroomNumber}`, 300, 326);
    } else if (invoice.leaseType === 'BEDROOM_WISE' || invoice.lease?.leaseType === 'BEDROOM_WISE') {
        doc.text('Bedroom Wise Rental', 300, 326);
    } else {
        doc.text('Full Unit Lease', 300, 326);
    }

    // --- TABLE SECTION ---
    const tableTop = 380;
    doc.fillColor(colors.accent).rect(50, tableTop, 500, 25).fill();

    doc.fillColor(colors.secondary).font('Helvetica-Bold').fontSize(9);
    doc.text('DESCRIPTION', 60, tableTop + 8);
    doc.text('CATEGORY', 250, tableTop + 8);
    doc.text('AMOUNT', 450, tableTop + 8, { align: 'right', width: 90 });

    let currentY = tableTop + 35;
    const drawRow = (desc, cat, amt) => {
        doc.fillColor(colors.text).font('Helvetica').fontSize(10).text(desc, 60, currentY, { width: 180 });
        doc.fillColor(colors.secondary).text(cat, 250, currentY);
        doc.fillColor(colors.text).font('Helvetica-Bold').text(`$${parseFloat(amt).toLocaleString(undefined, { minimumFractionDigits: 2 })}`, 450, currentY, { align: 'right', width: 90 });
        currentY += 25;
        doc.moveTo(50, currentY - 5).lineTo(550, currentY - 5).strokeColor(colors.accent).lineWidth(0.5).stroke();
    };

    // Rent Row
    if (parseFloat(invoice.rent) > 0) {
        drawRow('Monthly Rent Coverage', invoice.category === 'DEPOSIT' ? 'Security Deposit' : 'Rental Income', invoice.rent);
    }

    // Service Fees Row
    if (parseFloat(invoice.serviceFees) > 0) {
        drawRow(invoice.description || 'Service/Utility Fees', 'Service Charges', invoice.serviceFees);
    }

    // Other items? (Invoice amount fallback)
    if (currentY === tableTop + 35) {
        drawRow(invoice.description || 'Property Management Charges', invoice.category, invoice.amount);
    }

    // --- TOTALS SECTION ---
    currentY += 20;
    doc.fillColor(colors.accent).rect(340, currentY, 210, 80).fill();

    let totalY = currentY + 15;
    const drawTotalRow = (label, value, isBold = false) => {
        doc.fillColor(colors.secondary).font(isBold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).text(label, 350, totalY);
        doc.fillColor(isBold ? colors.primary : colors.text).font('Helvetica-Bold').fontSize(10).text(value, 450, totalY, { align: 'right', width: 90 });
        totalY += 20;
    };

    drawTotalRow('Subtotal:', `$${parseFloat(invoice.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
    drawTotalRow('Paid Amount:', `$${parseFloat(invoice.paidAmount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
    drawTotalRow('TOTAL DUE:', `$${parseFloat(invoice.balanceDue || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`, true);

    // --- FOOTER SECTION ---
    // Removed at user request

    doc.end();
};

/**
 * Generates a Payment Receipt PDF
 * @param {Object} payment - Invoice/Payment object from DB
 * @param {Object} res - Express response object
 */
const generateReceiptPDF = (payment, res) => {
    const doc = new PDFDocument({ margin: 50 });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=receipt-${payment.invoiceNo}.pdf`);

    doc.pipe(res);

    doc.fontSize(25).text('PAYMENT RECEIPT', { align: 'center' });
    doc.moveDown();

    doc.fontSize(12).text(`Receipt Number: RCP-${payment.id}`);
    doc.text(`Date of Payment: ${payment.paidAt ? new Date(payment.paidAt).toLocaleDateString() : 'N/A'}`);
    doc.text(`Invoice Reference: ${payment.invoiceNo}`);
    doc.moveDown();

    doc.fontSize(14).text('Payment Details:', { underline: true });
    doc.fontSize(12).text(`Tenant: ${payment.tenant.name}`);
    doc.text(`Unit: ${payment.unit.name}`);
    doc.text(`Amount Paid: $${parseFloat(payment.amount).toFixed(2)}`);
    doc.text(`Payment Method: ${payment.paymentMethod || 'Online'}`);
    doc.moveDown();

    doc.text('Status: PAID', { align: 'center', color: 'green' });

    doc.end();
};

/**
 * Generates a Lease Agreement PDF (Stub/Template)
 * @param {Object} lease - Lease object from DB
 * @param {Object} res - Express response object
 */
const generateLeasePDF = (lease, res) => {
    const doc = new PDFDocument({ margin: 50 });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=lease-${lease.id}.pdf`);

    doc.pipe(res);

    doc.fontSize(20).text('RESIDENTIAL LEASE AGREEMENT', { align: 'center' });
    doc.moveDown();

    doc.fontSize(12).text(`This agreement is made on ${new Date(lease.createdAt).toLocaleDateString()}.`);
    doc.moveDown();

    doc.text(`Landlord: Masteko Represented Owners`);
    doc.text(`Tenant: ${lease.tenant.name}`);
    doc.moveDown();

    doc.fontSize(14).text('1. PREMISES', { underline: true });
    doc.fontSize(12).text(`The landlord leases to the tenant the premises located at: Unit ${lease.unit.name}, ${lease.unit.property.name}.`);
    doc.moveDown();

    doc.fontSize(14).text('2. TERM', { underline: true });
    doc.fontSize(12).text(`The lease term shall begin on ${new Date(lease.startDate).toLocaleDateString()} and end on ${new Date(lease.endDate).toLocaleDateString()}.`);
    doc.moveDown();

    doc.fontSize(14).text('3. RENT', { underline: true });
    doc.fontSize(12).text(`The monthly rent shall be $${parseFloat(lease.monthlyRent).toFixed(2)} payable on the 1st of each month.`);
    doc.moveDown();

    doc.fontSize(14).text('4. SECURITY DEPOSIT', { underline: true });
    doc.fontSize(12).text(`The tenant has paid a security deposit of $${parseFloat(lease.securityDeposit).toFixed(2)}.`);
    doc.moveDown();

    doc.text('This is a formal lease agreement generated by Masteko.', 50, 700, { align: 'center' });

    doc.end();
};

/**
 * Generates a Generic Report PDF
 * @param {string} reportId - ID of report (placeholder logic)
 * @param {Object} res - Express response object
 */
/**
 * Generates a Dashboard Summary PDF (Move-In/Move-Out)
 * @param {string} title - Report Title
 * @param {Array} data - Array of items to list
 * @param {Object} res - Express response object
 */
const generateDashboardPDF = (title, data, res) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4' });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=report-${Date.now()}.pdf`);

    doc.pipe(res);

    const colors = {
        primary: '#4f46e5',
        secondary: '#64748b',
        text: '#1e293b',
        border: '#e2e8f0',
        headerBg: '#f8fafc'
    };

    // Header
    doc.fontSize(20).fillColor(colors.primary).font('Helvetica-Bold').text(title.toUpperCase(), { align: 'center' });
    doc.fontSize(10).fillColor(colors.secondary).font('Helvetica').text(`Generated on: ${new Date().toLocaleString()}`, { align: 'center' });
    doc.moveDown(2);

    // Table Header
    const tableTop = doc.y;
    doc.rect(40, tableTop, 515, 20).fill(colors.headerBg);
    doc.fillColor(colors.secondary).font('Helvetica-Bold').fontSize(9);
    
    doc.text('UNIT', 50, tableTop + 6);
    doc.text('TENANT', 120, tableTop + 6);
    doc.text('STATUS', 280, tableTop + 6);
    doc.text('DATE', 450, tableTop + 6);

    let currentY = tableTop + 25;
    doc.font('Helvetica').fontSize(9).fillColor(colors.text);

    data.forEach((item, index) => {
        // Simple page break check
        if (currentY > 750) {
            doc.addPage();
            currentY = 50;
        }

        const unitName = item.unit?.name || item.unit?.unitNumber || 'N/A';
        const tenantName = item.lease?.tenant?.name || 'N/A';
        const status = item.status || 'N/A';
        const date = item.lease?.startDate || item.lease?.endDate || item.createdAt;

        doc.text(unitName, 50, currentY);
        doc.text(tenantName, 120, currentY, { width: 150 });
        doc.text(status, 280, currentY);
        doc.text(new Date(date).toLocaleDateString(), 450, currentY);

        currentY += 20;
        doc.moveTo(40, currentY - 5).lineTo(555, currentY - 5).strokeColor(colors.border).lineWidth(0.5).stroke();
    });

    doc.end();
};

/**
 * Generates an Inspection Report PDF
 * @param {Object} inspection - Inspection object from DB
 * @param {Object} res - Express response object
 */
const generateInspectionPDF = async (inspection, res) => {
    const doc = new PDFDocument({
        margin: 40,
        size: 'A4',
        bufferPages: true
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=inspection-${inspection.id}.pdf`);

    doc.pipe(res);

    const colors = {
        primary: '#000000',
        secondary: '#64748b',
        text: '#1e293b',
        border: '#e2e8f0',
        success: '#10b981',
        danger: '#ef4444',
        headerBg: '#000000',
        rowAlt: '#f8fafc',
        tableHeader: '#e2e8f0'
    };

    // --- LOGO & HEADER ---
    const logoPath = path.join(__dirname, '..', 'assets', 'image.png');
    try {
        doc.image(logoPath, 40, 30, { width: 130 });
    } catch (e) {
        console.error('Logo not found:', logoPath);
    }

    const reportType = (inspection.template?.type || 'VISUAL').replace('_', ' ');
    const title = `${reportType} INSPECTION REPORT`.toUpperCase();

    doc.fontSize(16).fillColor(colors.primary).font('Helvetica-Bold').text(title, 160, 40, { align: 'right' });
    doc.fontSize(10).fillColor(colors.secondary).font('Helvetica').text(`Generated: ${new Date().toLocaleDateString()}`, 160, 60, { align: 'right' });

    doc.moveTo(40, 135).lineTo(555, 135).strokeColor(colors.border).lineWidth(1).stroke();

    // --- GENERAL INFORMATION ---
    let currentY = 150;
    doc.fillColor(colors.headerBg).rect(40, currentY, 515, 20).fill();
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(10).text('GENERAL INFORMATION', 50, currentY + 5);
    currentY += 25;

    const drawInfoRow = (label, value, x, y, width = 100) => {
        doc.fillColor(colors.secondary).font('Helvetica-Bold').fontSize(8).text(label.toUpperCase(), x, y);
        doc.fillColor(colors.text).font('Helvetica').fontSize(9).text(value || 'N/A', x, y + 10, { width, lineGap: 2 });
    };

    drawInfoRow('Inspection ID', `INSP-${inspection.id.toString().padStart(5, '0')}`, 50, currentY, 80);
    drawInfoRow('Type', inspection.template?.name, 140, currentY, 200);
    drawInfoRow('Status', inspection.status, 350, currentY, 80);
    drawInfoRow('Date', new Date(inspection.createdAt).toLocaleDateString(), 450, currentY, 80);

    currentY += 35;
    drawInfoRow('Property', inspection.unit?.property?.name, 50, currentY, 80);
    drawInfoRow('Unit', inspection.unit?.name, 140, currentY, 200);
    drawInfoRow('Tenant', inspection.lease?.tenant?.name, 350, currentY, 80);
    drawInfoRow('Inspector', inspection.inspector?.name, 450, currentY, 80);

    currentY += 45;

    // --- INSPECTION RESPONSES ---
    // Group responses by "Room" if available from template structure, else group by current grouping logic
    const responses = inspection.responses || [];
    
    // We try to group them by looking at the template structure rooms
    const rooms = inspection.template?.structure?.rooms || [{ name: 'Inspection Items', questions: [] }];
    
    for (const room of rooms) {
        // Find responses belonging to this room
        const roomResponses = responses.filter(r => {
            if (room.questions) {
                return room.questions.some(q => q.text === r.question);
            }
            return true; // Fallback for unstructured
        });

        if (roomResponses.length === 0 && rooms.length > 1) continue;

        // Check for page break
        if (currentY > 700) {
            doc.addPage();
            currentY = 50;
        }

        // Room Header
        doc.fillColor(colors.headerBg).rect(40, currentY, 515, 20).fill();
        doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(10).text(room.name.toUpperCase(), 50, currentY + 5);
        currentY += 20;

        // Table Header
        doc.fillColor(colors.tableHeader).rect(40, currentY, 515, 18).fill();
        doc.fillColor(colors.secondary).font('Helvetica-Bold').fontSize(8);
        doc.text('Q#', 50, currentY + 5);
        doc.text('QUESTION / ITEM', 80, currentY + 5);
        doc.text('RESPONSE', 400, currentY + 5);
        currentY += 18;

        for (const [idx, resp] of roomResponses.entries()) {
            // Determine response color (Red for deficiency) intelligently based on question
            const respText = (resp.response || '').toLowerCase();
            const qText = (resp.question || '').toLowerCase();
            
            const questionHasProblemFocus = ['égratignure', 'trou', 'tache', 'dommage', 'scratch', 'hole', 'stain', 'damage', 'brise', 'cassé'].some(word => qText.includes(word));
            
            let isDeficiency = false;
            if (questionHasProblemFocus) {
                // If the question asks about a problem/defect, answering "yes" or "oui" is a deficiency
                isDeficiency = ['oui', 'yes', 'visible'].some(word => respText.includes(word));
            } else {
                // Otherwise, standard negative words (or "no"/"non") are a deficiency
                const negativeResponseWords = ['poor', 'damaged', 'broken', 'dirty', 'repair', 'replace', 'deficient', 'bad', 'missing', 'issue', 'fail', 'non', 'no', 'endommagé', 'cassé', 'sale', 'mauvais', 'problème', 'tache'];
                isDeficiency = negativeResponseWords.some(word => respText.includes(word));
            }
            
            const respColor = isDeficiency ? colors.danger : colors.success;

            // Calculate height needed for question and notes
            const qHeight = doc.heightOfString(resp.question, { width: 300 });
            const nHeight = resp.notes ? doc.heightOfString(`Notes: ${resp.notes}`, { width: 300 }) : 0;
            
            let imgHeight = 0;
            let imgBuffer = null;
            const imgWidth = 200;
            const maxImgHeight = 200;

            if (resp.photoUrl) {
                try {
                    const imgRes = await axios.get(resp.photoUrl, { responseType: 'arraybuffer' });
                    imgBuffer = Buffer.from(imgRes.data, 'binary');
                    const img = doc.openImage(imgBuffer);
                    
                    let calcHeight = img.height * (imgWidth / img.width);
                    if (calcHeight > maxImgHeight) calcHeight = maxImgHeight;
                    
                    imgHeight = calcHeight + 15;
                } catch (err) {
                    console.error('Photo fetch error:', err.message);
                }
            }

            const rowHeight = Math.max(25, qHeight + nHeight + imgHeight + 15);

            // Page break check
            if (currentY + rowHeight > 750) {
                doc.addPage();
                currentY = 50;
                // Re-draw table header on new page
                doc.fillColor(colors.tableHeader).rect(40, currentY, 515, 18).fill();
                doc.fillColor(colors.secondary).font('Helvetica-Bold').fontSize(8);
                doc.text('Q#', 50, currentY + 5);
                doc.text('QUESTION / ITEM', 80, currentY + 5);
                doc.text('RESPONSE', 400, currentY + 5);
                currentY += 18;
            }

            // Zebra striping
            if (idx % 2 === 0) {
                doc.fillColor(colors.rowAlt).rect(40, currentY, 515, rowHeight).fill();
            }

            doc.fillColor(colors.text).font('Helvetica').fontSize(9).text(`${idx + 1}`, 50, currentY + 7);
            doc.text(resp.question, 80, currentY + 7, { width: 300 });
            
            if (resp.notes) {
                doc.fillColor(colors.secondary).fontSize(8).font('Helvetica-Oblique').text(`Notes: ${resp.notes}`, 80, currentY + qHeight + 10, { width: 300 });
            }

            if (imgBuffer) {
                doc.image(imgBuffer, 80, currentY + qHeight + nHeight + 12, { fit: [imgWidth, maxImgHeight] });
            }

            doc.fillColor(respColor).font('Helvetica-Bold').fontSize(9).text((resp.response || 'N/A').toUpperCase(), 400, currentY + 7, { width: 140 });

            currentY += rowHeight;
            doc.moveTo(40, currentY).lineTo(555, currentY).strokeColor(colors.border).lineWidth(0.5).stroke();
        }
        currentY += 15;
    }

    // --- TICKETS SECTION ---
    if (inspection.tickets && inspection.tickets.length > 0) {
        if (currentY > 650) {
            doc.addPage();
            currentY = 50;
        }

        doc.fillColor('#ef4444').rect(40, currentY, 515, 20).fill();
        doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(10).text('ACTION PLANS / TICKETS', 50, currentY + 5);
        currentY += 25;

        inspection.tickets.forEach((ticket, idx) => {
            if (currentY > 750) {
                doc.addPage();
                currentY = 50;
            }

            doc.fillColor(colors.text).font('Helvetica-Bold').fontSize(9).text(`${idx + 1}. ${ticket.subject}`, 50, currentY);
            doc.fillColor(colors.secondary).font('Helvetica').fontSize(8).text(ticket.description || 'No description', 60, currentY + 12, { width: 480 });
            
            const priorityColor = ticket.priority === 'High' ? '#ef4444' : '#f59e0b';
            doc.fillColor(priorityColor).font('Helvetica-Bold').text(`Priority: ${ticket.priority}`, 450, currentY, { align: 'right', width: 90 });
            
            currentY += 35;
            doc.moveTo(50, currentY - 5).lineTo(550, currentY - 5).strokeColor(colors.border).lineWidth(0.5).stroke();
        });
    }

    // --- SIGNATURES ---
    if (inspection.tenantSignature || inspection.inspectorSignature) {
        if (currentY > 600) {
            doc.addPage();
            currentY = 50;
        }
        
        currentY += 30;
        doc.moveTo(40, currentY).lineTo(555, currentY).strokeColor(colors.border).lineWidth(1).stroke();
        currentY += 20;

        const sigWidth = 150;
        const sigHeight = 60;

        // Tenant Signature
        if (inspection.tenantSignature) {
            doc.fillColor(colors.text).font('Helvetica-Bold').fontSize(10).text('TENANT SIGNATURE', 50, currentY);
            try {
                doc.image(inspection.tenantSignature, 50, currentY + 15, { width: sigWidth, height: sigHeight });
                doc.fontSize(8).fillColor(colors.secondary).text(`Signed by: ${inspection.lease?.tenant?.name || 'Tenant'}`, 50, currentY + 15 + sigHeight + 5);
            } catch (e) {
                doc.rect(50, currentY + 15, sigWidth, sigHeight).stroke();
            }
        }

        // Inspector Signature
        if (inspection.inspectorSignature) {
            doc.fillColor(colors.text).font('Helvetica-Bold').fontSize(10).text('INSPECTOR SIGNATURE', 350, currentY);
            try {
                doc.image(inspection.inspectorSignature, 350, currentY + 15, { width: sigWidth, height: sigHeight });
                doc.fontSize(8).fillColor(colors.secondary).text(`Signed by: ${inspection.inspector?.name || 'Inspector'}`, 350, currentY + 15 + sigHeight + 5);
            } catch (e) {
                doc.rect(350, currentY + 15, sigWidth, sigHeight).stroke();
            }
        }
    }

    doc.end();
};


module.exports = {
    generateInvoicePDF,
    generateReceiptPDF,
    generateLeasePDF,
    generateDashboardPDF,
    generateInspectionPDF
};
