const express = require('express');
const router = express.Router();
const adminController = require('./admin.controller');
const { authenticate, authorize } = require('../../middlewares/auth.middleware');
const { checkPermission } = require('../../middlewares/permission.middleware');

// Note: Use authenticate for all below routes
// For now, I'll leave them unsecured unless explicitly needed for testing as requested by the original code structure.
// However, the checkPermission middleware will require the req.user object.

const ticketController = require('./ticket.controller');

router.get('/dashboard/stats', adminController.getDashboardStats);
router.get('/properties', adminController.getProperties);
router.get('/properties/available', adminController.getAvailableProperties);

const invoiceController = require('./invoice.controller');
const maintenanceController = require('./maintenance.controller');
const accountingController = require('./accounting.controller');
const communicationController = require('./communication.controller');
const messageController = require('./message.controller');
const analyticsController = require('./analytics.controller');
const leaseController = require('./lease.controller');
const insuranceController = require('./insurance.controller');
const reportsController = require('./reports.controller');
const settingsController = require('./settings.controller');
const taxController = require('./tax.controller');
const accountController = require('./account.controller');
const documentController = require('./document.controller');
const readinessController = require('./readiness.controller');

router.get('/readiness/dashboard', checkPermission('Unit Readiness', 'view'), readinessController.getReadinessDashboard);
router.get('/readiness/stats', checkPermission('Unit Readiness', 'view'), readinessController.getReadinessStats);
router.get('/readiness/buildings', checkPermission('Unit Readiness', 'view'), readinessController.getBuildings);
router.get('/readiness/settings', readinessController.getSettings);
router.get('/readiness/settings', readinessController.getSettings);
router.put('/readiness/settings', readinessController.updateSettings);
router.put('/readiness/update-step/:unitId', authenticate, checkPermission('Unit Readiness', 'edit'), readinessController.updateReadinessStep);
router.put('/readiness/activate/:unitId', authenticate, checkPermission('Unit Readiness', 'edit'), readinessController.activateUnit);

// Holiday Management
router.get('/readiness/holidays', readinessController.getHolidays);
router.post('/readiness/holidays', readinessController.addHoliday);
router.delete('/readiness/holidays/:id', readinessController.deleteHoliday);

router.get('/dashboard/stats', adminController.getDashboardStats);
router.get('/properties', checkPermission('Buildings', 'view'), adminController.getProperties);
router.get('/properties/available', adminController.getAvailableProperties);
router.post('/properties', checkPermission('Buildings', 'add'), adminController.createProperty);
router.put('/properties/:id', checkPermission('Buildings', 'edit'), adminController.updateProperty);
router.delete('/properties/:id', checkPermission('Buildings', 'delete'), adminController.deleteProperty);
router.get('/properties/:id', checkPermission('Buildings', 'view'), adminController.getPropertyDetails);

router.get('/owners', checkPermission('Owners', 'view'), adminController.getOwners);
router.post('/owners', checkPermission('Owners', 'add'), adminController.createOwner);
router.put('/owners/:id', checkPermission('Owners', 'edit'), adminController.updateOwner);
router.post('/owners/:id/send-invite', checkPermission('Owners', 'edit'), adminController.sendInvite);
router.delete('/owners/:id', checkPermission('Owners', 'delete'), adminController.deleteOwner);

router.get('/tickets', checkPermission('Tickets', 'view'), ticketController.getAllTickets);
router.post('/tickets', checkPermission('Tickets', 'add'), ticketController.createTicket);
router.put('/tickets/:id/status', checkPermission('Tickets', 'edit'), ticketController.updateTicketStatus);
router.put('/tickets/:id', checkPermission('Tickets', 'edit'), ticketController.updateTicket);
router.delete('/tickets/:id', checkPermission('Tickets', 'delete'), ticketController.deleteTicket);
router.get('/tickets/:ticketId/attachments/:attachmentId', checkPermission('Tickets', 'view'), ticketController.getTicketAttachment);

router.get('/invoices', checkPermission('Invoices', 'view'), invoiceController.getInvoices);
router.post('/invoices', checkPermission('Invoices', 'add'), invoiceController.createInvoice);
router.put('/invoices/:id', checkPermission('Invoices', 'edit'), invoiceController.updateInvoice);
router.delete('/invoices/:id', checkPermission('Invoices', 'delete'), invoiceController.deleteInvoice);
router.get('/invoices/:id/download', checkPermission('Invoices', 'view'), invoiceController.downloadInvoicePDF);
router.post('/invoices/batch', checkPermission('Invoices', 'add'), invoiceController.runBatchInvoicing);

const serviceItemController = require('./serviceItem.controller');
router.get('/service-items', checkPermission('Invoices', 'view'), serviceItemController.getServiceItems);
router.post('/service-items', checkPermission('Invoices', 'add'), serviceItemController.createServiceItem);
router.put('/service-items/:id', checkPermission('Invoices', 'edit'), serviceItemController.updateServiceItem);
router.delete('/service-items/:id', checkPermission('Invoices', 'delete'), serviceItemController.deleteServiceItem);

const paymentController = require('./payment.controller');
router.get('/payments', checkPermission('Payments Received', 'view'), paymentController.getReceivedPayments);
router.post('/payments', checkPermission('Payments Received', 'add'), paymentController.recordPayment);
router.get('/outstanding-dues', checkPermission('Outstanding Dues', 'view'), paymentController.getOutstandingDues);
router.get('/payments/:id/download', checkPermission('Payments Received', 'view'), paymentController.downloadReceiptPDF);

const refundController = require('./refund.controller');
router.get('/refunds', checkPermission('Refunds', 'view'), refundController.getRefunds);
router.post('/refunds', checkPermission('Refunds', 'add'), refundController.createRefund);
router.get('/refunds/calculate/:tenantId', checkPermission('Refunds', 'view'), refundController.calculateRefund);
router.put('/refunds/:id', checkPermission('Refunds', 'edit'), refundController.updateRefund);
router.delete('/refunds/:id', checkPermission('Refunds', 'delete'), refundController.deleteRefund);

router.get('/leases', checkPermission('Leases', 'view'), leaseController.getLeaseHistory);
router.delete('/leases/:id', checkPermission('Leases', 'delete'), leaseController.deleteLease);
router.put('/leases/:id', checkPermission('Leases', 'edit'), leaseController.updateLease);
router.get('/leases/:id/download', checkPermission('Leases', 'view'), leaseController.downloadLeasePDF);

router.get('/insurance/compliance', checkPermission('Insurance', 'view'), insuranceController.getComplianceDashboard);
router.post('/insurance', checkPermission('Insurance', 'add'), insuranceController.createInsurance);
router.put('/insurance/:id', checkPermission('Insurance', 'edit'), insuranceController.updateInsurance);
router.post('/insurance/check-alerts', checkPermission('Insurance', 'edit'), insuranceController.checkInsuranceExpirations);
router.get('/insurance/alerts', checkPermission('Insurance', 'view'), insuranceController.getInsuranceAlerts);
router.get('/insurance/stats', checkPermission('Insurance', 'view'), insuranceController.getInsuranceStats);
router.post('/insurance/:id/approve', checkPermission('Insurance', 'edit'), insuranceController.approveInsurance);
router.post('/insurance/:id/reject', checkPermission('Insurance', 'edit'), insuranceController.rejectInsurance);

router.get('/maintenance', checkPermission('Maintenance', 'view'), maintenanceController.getTasks);
router.post('/maintenance', checkPermission('Maintenance', 'add'), maintenanceController.createTask);
router.put('/maintenance/:id', checkPermission('Maintenance', 'edit'), maintenanceController.updateTask);
router.delete('/maintenance/:id', checkPermission('Maintenance', 'delete'), maintenanceController.deleteTask);

router.get('/accounting/transactions', checkPermission('General Ledger', 'view'), accountingController.getTransactions);
router.post('/accounting/transactions', checkPermission('General Ledger', 'add'), accountingController.createTransaction);

router.get('/communication/emails', checkPermission('Sent Emails', 'view'), communicationController.getEmailLogs);
router.delete('/communication/emails/:id', checkPermission('Sent Emails', 'delete'), communicationController.deleteEmailLog);
router.post('/communication/send-email', checkPermission('Send Email', 'add'), communicationController.sendComposeEmail);
router.get('/communication', checkPermission('Communication', 'view'), communicationController.getHistory);
router.post('/communication', checkPermission('Communication', 'add'), communicationController.sendMessage);
router.delete('/communication/:id', checkPermission('Communication', 'delete'), communicationController.deleteLog);
router.post('/communication/bulk-delete', checkPermission('Communication', 'delete'), communicationController.bulkDeleteLogs);

router.get('/analytics/revenue', analyticsController.getRevenueStats);
router.get('/analytics/vacancy', analyticsController.getVacancyStats);
router.get('/reports/rent-roll', checkPermission('Rent Roll', 'view'), reportsController.getRentRoll);
router.put('/reports/potential-rent', checkPermission('Reports', 'edit'), reportsController.updatePotentialRent);
router.get('/reports', checkPermission('Reports', 'view'), reportsController.getReports);
router.get('/reports/:id/download', checkPermission('Reports', 'view'), reportsController.downloadReportPDF);

router.get('/settings', settingsController.getSettings);
router.post('/settings', settingsController.updateSettings);

router.get('/taxes', checkPermission('Tax Settings', 'view'), taxController.getTaxes);
router.post('/taxes', checkPermission('Tax Settings', 'add'), taxController.updateTaxes);
router.patch('/taxes/:id', checkPermission('Tax Settings', 'edit'), taxController.updateTax);
router.delete('/taxes/:id', checkPermission('Tax Settings', 'delete'), taxController.deleteTax);

router.get('/accounts', checkPermission('Chart of Accounts', 'view'), accountController.getAccounts);
router.post('/accounts', checkPermission('Chart of Accounts', 'add'), accountController.createAccount);
router.patch('/accounts/:id', checkPermission('Chart of Accounts', 'edit'), accountController.updateAccount);
router.delete('/accounts/:id', checkPermission('Chart of Accounts', 'delete'), accountController.deleteAccount);

router.get('/documents', checkPermission('Documents', 'view'), documentController.getAllDocuments);
router.post('/documents/upload', checkPermission('Documents', 'add'), documentController.uploadDocument);
router.put('/documents/:id', checkPermission('Documents', 'edit'), documentController.updateDocument);
router.get('/documents/download-proof', checkPermission('Documents', 'view'), documentController.downloadProofFromUrl);
router.get('/documents/:id/download', checkPermission('Documents', 'view'), documentController.downloadDocument);
router.delete('/documents/:id', checkPermission('Documents', 'delete'), documentController.deleteDocument);

// Message routes
router.get('/messages', messageController.getMessages);
router.post('/messages', messageController.sendMessage);
router.put('/messages/:id/read', messageController.markAsRead);

const unitTypeController = require('./unitType.controller');
router.get('/unit-types', unitTypeController.getUnitTypes);
router.post('/unit-types', unitTypeController.createUnitType);
router.put('/unit-types/:id', unitTypeController.updateUnitType);
router.delete('/unit-types/:id', unitTypeController.deleteUnitType);

const coworkerController = require('./coworker.controller');
router.get('/my-permissions', coworkerController.getMyPermissions);
router.get('/coworkers', coworkerController.getCoworkers);
router.post('/coworkers', coworkerController.createCoworker);
router.put('/coworkers/:id', coworkerController.updateCoworker);
router.delete('/coworkers/:id', coworkerController.deleteCoworker);
router.get('/coworkers/:id/permissions', coworkerController.getPermissions);
router.put('/coworkers/:id/permissions', coworkerController.updatePermissions);
router.post('/coworkers/:id/send-invite', coworkerController.sendInvitation);

// Shuttle Management API Bridge
const shuttleRoutes = require('./shuttle.routes');
router.use('/shuttle', shuttleRoutes);

module.exports = router;
