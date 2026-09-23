const express = require('express');
const router = express.Router();
const lockerController = require('./locker.controller');
const { authenticate } = require('../../middlewares/auth.middleware');
const { checkPermission } = require('../../middlewares/permission.middleware');

// Apply authentication middleware to all routes
router.use(authenticate);

// Locker inventory management
router.get('/', checkPermission('Locker Inventory', 'view'), lockerController.getLockers);
router.post('/', checkPermission('Locker Inventory', 'add'), lockerController.createLocker);
router.put('/:id', checkPermission('Locker Inventory', 'edit'), lockerController.updateLocker);
router.delete('/:id', checkPermission('Locker Inventory', 'delete'), lockerController.deleteLocker);

module.exports = router;
