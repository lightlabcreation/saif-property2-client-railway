const express = require('express');
const router = express.Router();

// Import module routes
const authRoutes = require('./modules/auth/auth.routes');
const adminRoutes = require('./modules/admin/admin.routes');
const tenantRoutes = require('./modules/admin/tenant.routes');
const leaseRoutes = require('./modules/admin/lease.routes');
const unitRoutes = require('./modules/admin/unit.routes');
const vehicleRoutes = require('./modules/admin/vehicle.routes');
// const ownerRoutes = require('./modules/owner/owner.routes');
// const tenantRoutes = require('./modules/tenant/tenant.routes');

// Health Check
router.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date() });
});

const ownerRoutes = require('./modules/owner/owner.routes');

const tenantPortalRoutes = require('./modules/tenant/tenant.portal.routes');

const { authenticate } = require('./middlewares/auth.middleware');
const { checkPermission } = require('./middlewares/permission.middleware');

router.use('/auth', authRoutes);

// Protected Admin Routes
// 🌍 PUBLIC WEBHOOKS (No Authentication Required)
// These MUST be before any router.use(authenticate) lines
const twilioWebhookController = require('./modules/communication/twilio.webhook.controller');
router.post('/webhooks/twilio/sms/incoming', twilioWebhookController.handleIncomingSMS);
router.post('/webhooks/twilio/sms/status', twilioWebhookController.handleSMSStatusCallback);

// 🔒 PROTECTED MODULES (All routes below this line require authentication)
router.use('/admin/tenants', authenticate, tenantRoutes);
router.use('/admin/leases', authenticate, leaseRoutes);
router.use('/admin/units', authenticate, unitRoutes);
router.use('/admin/vehicles', authenticate, vehicleRoutes);
router.use('/admin/email', authenticate, require('./modules/email/email.routes'));
router.use('/admin/workflow', authenticate, require('./modules/admin/workflow.routes'));
router.use('/admin', authenticate, adminRoutes);

router.use('/owner', authenticate, ownerRoutes);
router.use('/tenant', authenticate, tenantPortalRoutes);
router.use('/communication', authenticate, require('./modules/communication/communication.routes'));

module.exports = router;
