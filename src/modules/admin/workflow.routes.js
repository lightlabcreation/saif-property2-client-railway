const express = require('express');
const router = express.Router();
const workflowController = require('./workflow.controller');
const inspectionController = require('./inspection.controller');
const { authorize, authenticate } = require('../../middlewares/auth.middleware');
const { checkPermission } = require('../../middlewares/permission.middleware');

// Move-In / Move-Out Dashboard Routes
router.get('/units', workflowController.getInspectionUnits);
router.get('/move-in', workflowController.getMoveInDashboard);
router.get('/move-in/export', workflowController.exportMoveInPDF);
router.get('/move-out', workflowController.getMoveOutDashboard);
router.get('/move-out/export', workflowController.exportMoveOutPDF);
router.post('/move-out/:id/approve', checkPermission('Move-Out', 'edit'), workflowController.approveMoveOut);
router.put('/move-out/:id/confirm', checkPermission('Move-Out', 'edit'), workflowController.confirmMoveOut);
router.put('/move-out/:id/schedule-final', checkPermission('Move-Out', 'edit'), workflowController.scheduleFinalInspection);
router.put('/move-out/:id/complete', checkPermission('Move-Out', 'edit'), workflowController.completeMoveOut);
router.post('/move-in/:id/override', checkPermission('Move-In', 'edit'), workflowController.overrideMoveIn);
router.post('/move-in/:id/approve', checkPermission('Move-In', 'edit'), workflowController.approveMoveIn);
router.put('/move-in/:id/cancel', checkPermission('Move-In', 'edit'), workflowController.cancelMoveIn);
router.put('/move-in/:moveInId/requirement', checkPermission('Move-In', 'edit'), workflowController.toggleMoveInRequirement);
router.get('/unit-prep', checkPermission('Unit Preparation', 'view'), workflowController.getUnitPrepDashboard);
router.get('/unit-prep/export', checkPermission('Unit Preparation', 'view'), workflowController.exportUnitPrepPDF);
router.put('/unit-prep/:unitId/stage', checkPermission('Unit Preparation', 'edit'), workflowController.updateUnitPrepStage);
router.put('/unit-prep/:unitId/override', checkPermission('Unit Preparation', 'edit'), workflowController.overrideUnitPrepBlock);
router.post('/move-out/trigger/:leaseId', workflowController.triggerMoveOut);
router.put('/move-out/cancel/:leaseId', checkPermission('Move-Out', 'edit'), workflowController.cancelMoveOut);

// Inspection Routes
router.post('/templates', inspectionController.createTemplate);
router.post('/templates/:id/duplicate', inspectionController.duplicateTemplate);
router.put('/templates/:id', inspectionController.updateTemplate);
router.delete('/templates/:id', inspectionController.deleteTemplate);
router.get('/templates', inspectionController.getTemplates);
router.post('/inspections', inspectionController.createInspection);
router.get('/inspections', inspectionController.getAllInspections);
router.get('/inspections/:id', inspectionController.getInspectionDetails);
router.get('/inspections/:id/download', inspectionController.downloadInspectionPDF);
router.post('/inspections/:id/submit', inspectionController.submitInspection);
router.post('/inspections/:id/tickets', inspectionController.createTicket);
router.delete('/inspections/:id/tickets/:ticketId', inspectionController.deleteTicket);
router.put('/inspections/:id', inspectionController.updateInspection);
router.delete('/inspections/:id', authorize('ADMIN'), inspectionController.deleteInspection);
router.post('/inspections/upload-media', inspectionController.uploadInspectionMedia);

// Unit History
router.get('/units/:unitId/history', workflowController.getUnitHistory);

// Response Series Routes
router.get('/response-series', inspectionController.getResponseSeries);
router.post('/response-series', inspectionController.createResponseSeries);
router.put('/response-series/:id', inspectionController.updateResponseSeries);
router.delete('/response-series/:id', inspectionController.deleteResponseSeries);

module.exports = router;
