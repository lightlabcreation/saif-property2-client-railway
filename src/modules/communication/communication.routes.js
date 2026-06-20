const express = require('express');

const router = express.Router();
const communicationController = require('./communication.controller');
const smsController = require('./sms.controller');
const { authenticate } = require('../../middlewares/auth.middleware');
const { checkPermission, checkAnyPermission } = require('../../middlewares/permission.middleware');

// Authenticated routes
router.use(authenticate);

// Standard Communication
router.post('/send', checkPermission('Inbox', 'add'), communicationController.sendMessage);
router.get('/history/:userId', checkPermission('Inbox', 'view'), communicationController.getHistory);
router.get('/conversations', checkPermission('Inbox', 'view'), communicationController.getConversations);
router.post('/mark-read', checkPermission('Inbox', 'edit'), communicationController.markAsRead);

// SMS Enhancement Module
router.get('/templates', checkAnyPermission(['Templates', 'Inbox', 'Campaign Manager'], 'view'), smsController.getTemplates);
router.post('/templates', checkPermission('Templates', 'add'), smsController.createTemplate);
router.put('/templates/:id', checkPermission('Templates', 'edit'), smsController.updateTemplate);
router.delete('/templates/:id', checkPermission('Templates', 'delete'), smsController.deleteTemplate);
router.post('/campaign', checkPermission('Campaign Manager', 'add'), smsController.createCampaign);
router.get('/campaigns', checkPermission('Campaign Manager', 'view'), smsController.getCampaigns);
router.delete('/campaign/:id', checkPermission('Campaign Manager', 'delete'), smsController.deleteCampaign);
router.post('/campaign/:id/retry', checkPermission('Campaign Manager', 'edit'), smsController.retryCampaign);
router.get('/campaign/:id/failures', checkPermission('Campaign Manager', 'view'), smsController.getCampaignFailures);
router.get('/unread-stats', checkPermission('Inbox', 'view'), smsController.getUnreadStats);

module.exports = router;
