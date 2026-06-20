const express = require('express');
const router = express.Router();
const emailController = require('./email.controller');
const { authenticate } = require('../../middlewares/auth.middleware');
const { checkPermission, checkAnyPermission } = require('../../middlewares/permission.middleware');

// Apply auth to all email routes
router.use(authenticate);

// Templates
router.get('/templates', checkAnyPermission(['Email Templates', 'Send Email'], 'view'), emailController.getTemplates);
router.post('/templates', checkPermission('Email Templates', 'add'), emailController.createTemplate);
router.put('/templates/:id', checkPermission('Email Templates', 'edit'), emailController.updateTemplate);
router.delete('/templates/:id', checkPermission('Email Templates', 'delete'), emailController.deleteTemplate);

// Sending
router.post('/send-bulk', checkPermission('Send Email', 'add'), emailController.sendBulkEmails);

// History
router.get('/history', checkPermission('Sent Emails', 'view'), emailController.getHistory);
router.get('/history/:id', checkPermission('Sent Emails', 'view'), emailController.getLogDetails);
router.post('/history/:id/resend', checkPermission('Sent Emails', 'add'), emailController.resendEmail);

// Signature
router.get('/signature', checkAnyPermission(['Email Hub', 'Send Email'], 'view'), emailController.getSignature);
router.post('/signature', checkPermission('Email Hub', 'edit'), emailController.updateSignature);

module.exports = router;
