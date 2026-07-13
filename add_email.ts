import fs from 'fs';
import path from 'path';

const emailFile = path.join(process.cwd(), 'src/services/email.service.ts');
let emailContent = fs.readFileSync(emailFile, 'utf8');

const newEmailMethod = `
  /**
   * Envía confirmación de cita al paciente cuando el doctor agendó directamente.
   * Incluye la clínica y banners promocionales de Zenda.
   */
  async sendDoctorAppointmentConfirmation({ to, patientName, date, time, doctorName, clinicName }: { to: string, patientName: string, date: string, time: string, doctorName: string, clinicName: string }) {
    try {
      const htmlContent = \`
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Confirmación de Cita - Zenda</title>
        <style>
          body {
            font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
            background-color: #f8fafc;
            color: #334155;
            margin: 0;
            padding: 0;
          }
          .container {
            max-width: 600px;
            margin: 40px auto;
            background-color: #ffffff;
            border-radius: 12px;
            overflow: hidden;
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
            border: 1px solid #e2e8f0;
          }
          .header {
            background-color: #0ea5e9;
            padding: 30px 20px;
            text-align: center;
            color: white;
          }
          .header h1 {
            margin: 0;
            font-size: 24px;
            font-weight: 600;
          }
          .content {
            padding: 30px;
          }
          .greeting {
            font-size: 18px;
            font-weight: 600;
            margin-bottom: 20px;
            color: #0f172a;
          }
          .details-card {
            background-color: #f1f5f9;
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 30px;
          }
          .detail-row {
            margin-bottom: 12px;
            font-size: 15px;
          }
          .detail-row:last-child {
            margin-bottom: 0;
          }
          .detail-label {
            font-weight: 600;
            color: #475569;
            display: inline-block;
            width: 90px;
          }
          .detail-value {
            color: #0f172a;
            font-weight: 500;
          }
          .turno-badge {
            display: inline-block;
            background-color: #e0f2fe;
            color: #0369a1;
            padding: 4px 10px;
            border-radius: 9999px;
            font-size: 13px;
            font-weight: 600;
            margin-top: 8px;
          }
          .promo-section {
            text-align: center;
            padding-top: 20px;
            border-top: 1px solid #e2e8f0;
          }
          .promo-title {
            font-size: 16px;
            font-weight: 600;
            color: #0f172a;
            margin-bottom: 10px;
          }
          .promo-text {
            font-size: 14px;
            color: #64748b;
            line-height: 1.5;
            margin-bottom: 20px;
          }
          .store-buttons {
            display: flex;
            justify-content: center;
            gap: 12px;
            margin-bottom: 10px;
          }
          .store-btn {
            display: inline-block;
            background-color: #0f172a;
            color: #ffffff !important;
            text-decoration: none;
            padding: 10px 16px;
            border-radius: 8px;
            font-size: 13px;
            font-weight: 500;
          }
          .footer {
            background-color: #f8fafc;
            padding: 20px;
            text-align: center;
            font-size: 12px;
            color: #94a3b8;
            border-top: 1px solid #e2e8f0;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Tu Cita Médica</h1>
          </div>
          <div class="content">
            <div class="greeting">Hola \${patientName},</div>
            <p style="font-size: 15px; color: #475569; margin-bottom: 20px;">
              Tu cita ha sido confirmada exitosamente. Aquí tienes los detalles:
            </p>
            
            <div class="details-card">
              <div class="detail-row">
                <span class="detail-label">Fecha:</span>
                <span class="detail-value">\${date}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Hora:</span>
                <span class="detail-value">\${time}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Doctor(a):</span>
                <span class="detail-value">\${doctorName}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Sede:</span>
                <span class="detail-value">\${clinicName}</span>
              </div>
              <div>
                <span class="turno-badge">Turno: [Se asignará el día de la consulta]</span>
              </div>
            </div>
  
            <div class="promo-section">
              <div class="promo-title">Toma el control de tu salud con Zenda</div>
              <p class="promo-text">
                Descarga nuestra app gratuita para llevar tu historial médico en el bolsillo, 
                gestionar tus próximas citas y recibir recordatorios automáticos.
              </p>
              <div class="store-buttons">
                <a href="#" class="store-btn">[Descargar en App Store]</a>
                <a href="#" class="store-btn">[Disponible en Google Play]</a>
              </div>
            </div>
          </div>
          <div class="footer">
            © \${new Date().getFullYear()} Zenda Health. Todos los derechos reservados.<br>
            Este es un correo generado automáticamente, por favor no respondas a este mensaje.
          </div>
        </div>
      </body>
      </html>
      \`;
  
      await resend.emails.send({
        from: FROM_EMAIL, 
        to,
        subject: \`Confirmación de cita - \${date} a las \${time}\`,
        html: htmlContent,
      });
  
      console.log(\`[Email Service] Correo enviado exitosamente a \${to}.\`);
    } catch (error) {
      console.error('[Email Service] Error al enviar el correo:', error);
    }
  },
`;

emailContent = emailContent.replace(
  /export const emailService = \{/,
  `export const emailService = {\n${newEmailMethod}`
);

fs.writeFileSync(emailFile, emailContent);


// Now inject the email sending logic into doctor.controller.ts
const controllerFile = path.join(process.cwd(), 'src/controllers/doctor.controller.ts');
let controllerContent = fs.readFileSync(controllerFile, 'utf8');

if (!controllerContent.includes("import { emailService }")) {
  controllerContent = controllerContent.replace(
    /import prisma from '\.\.\/prisma';/,
    `import prisma from '../prisma';\nimport { emailService } from '../services/email.service';`
  );
}

const sendEmailLogic = `
    const appointment = await prisma.appointment.create({
      data: {
        patientId: finalPatientId,
        doctorProfileId: doctor.id,
        clinicProfileId: clinicId,
        serviceId: finalServiceId,
        date: new Date(date),
        startTime,
        endTime,
        status: type === 'cita' ? 'CONFIRMED' : 'PENDING',
        notes: title || type
      }
    });

    if (type === 'cita') {
      try {
        const patientData = await prisma.user.findUnique({
          where: { id: finalPatientId },
          select: { email: true, firstName: true }
        });
        
        const clinicData = await prisma.clinicProfile.findUnique({
          where: { id: clinicId },
          select: { name: true }
        });

        if (patientData && patientData.email && clinicData) {
          const formattedDate = new Date(date).toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
          emailService.sendDoctorAppointmentConfirmation({
            to: patientData.email,
            patientName: patientData.firstName,
            date: formattedDate,
            time: startTime,
            doctorName: doctor.user.firstName + ' ' + doctor.user.lastName,
            clinicName: clinicData.name
          }).catch(err => console.error("Error async email", err));
        }
      } catch (emailError) {
        console.error("Error intentando enviar correo:", emailError);
      }
    }
`;

controllerContent = controllerContent.replace(
  /const appointment = await prisma\.appointment\.create\(\{[\s\S]*?notes: title \|\| type\n\s*\}\n\s*\}\);/,
  sendEmailLogic.trim()
);

fs.writeFileSync(controllerFile, controllerContent);
console.log("Injected email service logic");
