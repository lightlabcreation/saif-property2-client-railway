const express = require('express');
const router = express.Router();
const unitController = require('./unit.controller');

const { checkPermission } = require('../../middlewares/permission.middleware');

router.get('/dropdown', checkPermission('Units', 'view'), unitController.getUnitDropdown);
router.get('/', checkPermission('Units', 'view'), unitController.getAllUnits);
router.post('/', checkPermission('Units', 'add'), unitController.createUnit);
router.get('/types', checkPermission('Units', 'view'), unitController.getUnitTypes);
router.post('/types', checkPermission('Units', 'edit'), unitController.createUnitType);
router.delete('/types/:id', checkPermission('Units', 'edit'), unitController.deleteUnitType);
router.get('/bedrooms/vacant', checkPermission('Units', 'view'), unitController.getVacantBedrooms);
router.get('/:id', checkPermission('Units', 'view'), unitController.getUnitDetails);
router.put('/:id', checkPermission('Units', 'edit'), unitController.updateUnit);
router.delete('/:id', checkPermission('Units', 'delete'), unitController.deleteUnit);

module.exports = router;
