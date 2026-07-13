import fs from 'fs';
import path from 'path';

const file = path.join(process.cwd(), 'src/controllers/doctor.controller.ts');
let content = fs.readFileSync(file, 'utf8');

const injection = `
    if (finalPatientId === 'temp-patient-123') {
      let tempP = await prisma.user.findUnique({ where: { email: 'temp@vitali.com' } });
      if (!tempP) {
        tempP = await prisma.user.create({
          data: {
            email: 'temp@vitali.com',
            passwordHash: 'dummy',
            firstName: 'Paciente',
            lastName: 'Temporal',
            role: 'PATIENT'
          }
        });
      }
      finalPatientId = tempP.id;
    }

    if (finalServiceId === 'temp-service-123') {
      let tempS = await prisma.service.findFirst();
      if (!tempS) {
        tempS = await prisma.service.create({
          data: {
            name: 'Servicio Temporal',
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
console.log("Updated doctor.controller.ts with temp IDs handler");
