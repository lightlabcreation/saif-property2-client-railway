/**
 * Generates the next sequential invoice number for a given prefix.
 * E.g., if prefix is 'INV-MAN' and the latest invoice is 'INV-MAN-00005', it returns 'INV-MAN-00006'.
 */
async function generateInvoiceNo(prisma, prefix) {
    const lastInvoice = await prisma.findFirst({
        where: {
            invoiceNo: {
                startsWith: prefix
            }
        },
        orderBy: {
            invoiceNo: 'desc'
        },
        select: {
            invoiceNo: true
        }
    });

    let nextNum = 1;
    if (lastInvoice) {
        const suffix = lastInvoice.invoiceNo.slice(prefix.length + 1);
        const match = suffix.match(/^(\d+)/);
        if (match) {
            nextNum = parseInt(match[1], 10) + 1;
        }
    }

    return `${prefix}-${String(nextNum).padStart(5, '0')}`;
}

module.exports = {
    generateInvoiceNo
};
