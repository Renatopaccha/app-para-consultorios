import fs from 'fs';
import path from 'path';

const file = path.join(process.cwd(), 'src/routes/doctor.routes.ts');
let content = fs.readFileSync(file, 'utf8');

content = content.replace(
  /import \{\s*getMyAppointments,[\s\S]*?\} from '\.\.\/controllers\/doctor\.controller';/,
  `import { getDoctors, getDoctorById, createDoctor, getMyAppointments, updateDoctorProfile, addService, addCertification, addWorkSchedule, getMySchedules, addAppointment, createGuestPatient, searchPatients } from '../controllers/doctor.controller';`
);

fs.writeFileSync(file, content);
console.log("Restored all doctor imports");
