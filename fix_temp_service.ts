import fs from 'fs';
import path from 'path';

const file = path.join(process.cwd(), 'src/controllers/doctor.controller.ts');
let content = fs.readFileSync(file, 'utf8');

const injection = `
    if (finalServiceId === 'temp-service-123') {
      let tempS = await prisma.service.findFirst();
      if (!tempS) {
        tempS = await prisma.service.create({
          data: {
            name: 'Consulta Temporal',
            duration: 30,
            price: 50
          }
        });
      }
      finalServiceId = tempS.id;
    }

    if (!finalPatientId || !finalServiceId) {
`;

content = content.replace(
  /if \(\!finalPatientId \|\| \!finalServiceId\) \{/,
  injection.trimLeft()
);

fs.writeFileSync(file, content);
console.log("Restored temp-service-123 bypass in backend");
