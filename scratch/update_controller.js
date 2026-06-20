const fs = require('fs');
const path = 'c:/Users/Saif16/Desktop/clinet_property/backend/src/modules/admin/inspection.controller.js';
let content = fs.readFileSync(path, 'utf8');

// 1. Update signature extraction
content = content.replace(
    /const { signature, noDeficiencyConfirmed, responses } = req.body;/g,
    'const { signature, inspectorSignature, noDeficiencyConfirmed, responses } = req.body;'
);

// 2. Update validation
const oldValidation = `        // 1. Tenant signature is mandatory
        if (!signature && !noDeficiencyConfirmed) {
            return res.status(400).json({ success: false, message: 'Tenant signature or No Deficiency confirmation is required.' });
        }`;

const newValidation = `        // 1. Dual signatures are mandatory unless no deficiency is confirmed
        if (!noDeficiencyConfirmed) {
            if (!signature) return res.status(400).json({ success: false, message: 'Tenant signature is required.' });
            if (!inspectorSignature) return res.status(400).json({ success: false, message: 'Inspector signature is required.' });
        }`;

// We'll use a more flexible regex for validation because of indentation
content = content.replace(/\/\/ 1\. Tenant signature is mandatory[\s\S]+?}/, newValidation);

// 3. Update completeInspection call
content = content.replace(
    /await workflowService\.completeInspection\(parseInt\(id\), {[\s\S]+?}\);/,
    `await workflowService.completeInspection(parseInt(id), {
            signature,
            inspectorSignature,
            noDeficiencyConfirmed
        });`
);

// 4. Update Smart Blocking
content = content.replace(
    /\/\/ 3\. Update Unit to Blocked status \(Triggered by any inspection deficiency\)[\s\S]+?}\);/,
    `// 3. Update Unit to Blocked status IF ticket is REQUIRED
            if (isRequired !== false) {
                await prisma.unit.update({
                    where: { id: inspection.unitId },
                    data: {
                        status_note: \`Blocked - Required Repair Found (\${inspection.template?.type || 'INSPECTION'})\`,
                        current_stage: 'PENDING_TICKETS'
                    }
                });
            }`
);

fs.writeFileSync(path, content);
console.log('Update successful');
