import fs from 'fs';
import path from 'path';

const file = path.join(__dirname, 'src/controllers/doctor.controller.ts');
let content = fs.readFileSync(file, 'utf8');

const newFunction = `
export const addAppointment = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'No autorizado' });

    const doctor = await prisma.doctorProfile.findUnique({ where: { userId } });
    if (!doctor) return res.status(404).json({ error: 'Perfil no encontrado' });

    const { clinicId, date, startTime, endTime, type, title, patientId, serviceId } = req.body;
    if (!clinicId || !date || !startTime || !endTime) {
      return res.status(400).json({ error: 'Faltan campos obligatorios' });
    }

    let finalPatientId = patientId;
    let finalServiceId = serviceId;

    if (type === 'bloqueo' || type === 'personal') {
      // Create or find dummy patient for blocks
      let dummyPatient = await prisma.user.findUnique({ where: { email: 'block@vitali.com' } });
      if (!dummyPatient) {
        dummyPatient = await prisma.user.create({
          data: {
            email: 'block@vitali.com',
            passwordHash: 'dummy',
            firstName: 'Bloqueo',
            lastName: 'Sistema',
            role: 'PATIENT'
          }
        });
      }
      finalPatientId = dummyPatient.id;

      // Create or find dummy service
      let dummyService = await prisma.service.findFirst({ where: { name: 'Bloqueo de Horario' } });
      if (!dummyService) {
        dummyService = await prisma.service.create({
          data: {
            name: 'Bloqueo de Horario',
            duration: 60,
            price: 0
          }
        });
      }
      finalServiceId = dummyService.id;
    }

    if (!finalPatientId || !finalServiceId) {
      return res.status(400).json({ error: 'patientId y serviceId son obligatorios para citas médicas' });
    }

    const appointment = await prisma.appointment.create({
      data: {
        patientId: finalPatientId,
        doctorProfileId: doctor.id,
        clinicProfileId: clinicId,
        serviceId: finalServiceId,
        date: new Date(date),
        startTime,
        endTime,
        status: type === 'cita' ? 'CONFIRMED' : 'BLOCKED_GOOGLE', // Utilizamos BLOCKED_GOOGLE o PENDING según aplique
        notes: title || type
      }
    });

    res.status(201).json(appointment);
  } catch (error) {
    console.error('[Doctor Controller] Error en addAppointment:', error);
    res.status(500).json({ error: 'Error al crear el registro' });
  }
};
`;

if (!content.includes('export const addAppointment')) {
  content += '\n' + newFunction;
  fs.writeFileSync(file, content);
  console.log("Added addAppointment to doctor.controller.ts");
}
