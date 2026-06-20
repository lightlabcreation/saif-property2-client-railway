const express = require('express');
const router = express.Router();
const tenantController = require('./tenant.controller');

const { checkPermission, checkAnyPermission } = require('../../middlewares/permission.middleware');

router.get('/', checkAnyPermission(['Tenant List', 'Shuttle'], 'view'), tenantController.getAllTenants);
router.get('/:id', checkPermission('Tenant List', 'view'), tenantController.getTenantById);
router.get('/:id/tickets', checkPermission('Tenant List', 'view'), tenantController.getTenantTickets);
router.post('/', checkPermission('Tenant List', 'add'), tenantController.createTenant);
router.put('/:id', checkPermission('Tenant List', 'edit'), tenantController.updateTenant);
router.post('/:id/send-invite', checkPermission('Tenant List', 'edit'), tenantController.sendInvite);
router.delete('/:id', checkPermission('Tenant List', 'delete'), tenantController.deleteTenant);

module.exports = router;
