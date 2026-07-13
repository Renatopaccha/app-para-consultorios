import fs from 'fs';
import path from 'path';

const controllerFile = path.join(process.cwd(), 'src/controllers/doctor.controller.ts');
let controllerContent = fs.readFileSync(controllerFile, 'utf8');

const importBcrypt = `import bcrypt from 'bcryptjs';\n`;
if (!controllerContent.includes("import bcrypt")) {
  controllerContent = importBcrypt + controllerContent;
}

const guestPatientCode = `
/**
 * POST /api/doctors/patients/guest
 * Crea una cuenta fantasma (Shadow Account) para pacientes sin registrar.
 * Retorna el ID del usuario creado o del usuario existente.
 */
export const createGuestPatient = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'No autorizado' });

    // Nota: Aunque recibamos "cedula", en el esquema actual Prisma User no tiene ese campo. 
    // Filtraremos por email principalmente.
    const { firstName, lastName, email, cedula } = req.body;

    if (!firstName || !lastName || !email) {
      return res.status(400).json({ error: 'firstName, lastName y email son obligatorios' });
    }

    // Anti-Enredo: Verificar si ya existe en BD
    let existingUser = await prisma.user.findUnique({
      where: { email }
    });

    if (existingUser) {
      return res.status(200).json({ 
        message: 'Paciente ya existe', 
        patientId: existingUser.id 
      });
    }

    // Crear Shadow Account
    const randomPassword = Math.random().toString(36).slice(-10) + 'A1!'; // Contraseña segura aleatoria
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(randomPassword, salt);

    const newUser = await prisma.user.create({
      data: {
        firstName,
        lastName,
        email,
        passwordHash,
        role: 'PATIENT'
        // fcmToken: null
      }
    });

    return res.status(201).json({ 
      message: 'Cuenta fantasma creada exitosamente', 
      patientId: newUser.id 
    });

  } catch (error: any) {
    console.error('[Doctor Controller] Error en createGuestPatient:', error);
    res.status(500).json({ error: 'Error al crear la cuenta fantasma del paciente' });
  }
};
`;

controllerContent += "\n" + guestPatientCode;
fs.writeFileSync(controllerFile, controllerContent);

const routesFile = path.join(process.cwd(), 'src/routes/doctor.routes.ts');
let routesContent = fs.readFileSync(routesFile, 'utf8');

// Ensure createGuestPatient is imported
routesContent = routesContent.replace(
  /import \{([^}]+)\} from '\.\.\/controllers\/doctor\.controller';/,
  (match, p1) => \`import { \${p1.trim()}, createGuestPatient } from '../controllers/doctor.controller';\`
);

const newRoute = `
// Creación de cuenta fantasma para paciente (Modal)
router.post('/patients/guest', createGuestPatient);
`;

routesContent = routesContent.replace(
  /export default router;/,
  newRoute.trim() + "\n\nexport default router;"
);

fs.writeFileSync(routesFile, routesContent);

console.log("Added createGuestPatient to doctor.controller and doctor.routes");
