import fs from 'fs';
import path from 'path';

const file = path.join(process.cwd(), 'src/controllers/doctor.controller.ts');
let content = fs.readFileSync(file, 'utf8');

const regex = /if \(finalPatientId === 'temp-patient-123'\) \{[\s\S]*?if \(!finalPatientId \|\| !finalServiceId\) \{/;

content = content.replace(regex, 'if (!finalPatientId || !finalServiceId) {');

fs.writeFileSync(file, content);
console.log("Cleaned up temp IDs from doctor.controller.ts");
