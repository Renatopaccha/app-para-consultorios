import { Resend } from 'resend';

// Inicializamos Resend con la variable de entorno
const resend = new Resend(process.env.RESEND_API_KEY);

// Remitente en Sandbox (para pruebas de Resend)
const FROM_EMAIL = 'onboarding@resend.dev';

// Diccionario para traducir los roles técnicos a un español elegante
const roleTranslations: Record<string, string> = {
  PATIENT: 'paciente',
  DOCTOR: 'médico especialista',
  CLINIC_ADMIN: 'administrador de clínica',
  ASSISTANT: 'asistente médico',
  SUPER_ADMIN: 'administrador principal'
};

export type InvitationEmail = { to: string; role: string; token: string; expiresAt: Date };
export type InvitationEmailAdapter = (email: InvitationEmail) => Promise<void>;
export type CashPaymentCodeEmail = { to: string; code: string; doctorName: string; clinicName: string; serviceName: string; startsAt: Date; amountCents: number; currency: string };
export type CashPaymentCodeEmailAdapter = (email: CashPaymentCodeEmail) => Promise<void>;
export type PatientInvitationEmail = { to: string; firstName: string; token: string; expiresAt: Date };
export type PatientInvitationEmailAdapter = (email: PatientInvitationEmail) => Promise<void>;
export type EmailVerification = { to: string; firstName: string; token: string };
export type EmailVerificationAdapter = (email: EmailVerification) => Promise<void>;

// Integration tests use this in-memory adapter; production always calls Resend.
let invitationEmailAdapter: InvitationEmailAdapter | undefined;
let cashPaymentCodeEmailAdapter: CashPaymentCodeEmailAdapter | undefined;
let patientInvitationEmailAdapter: PatientInvitationEmailAdapter | undefined;
let emailVerificationAdapter: EmailVerificationAdapter | undefined;

export function setInvitationEmailAdapterForTests(adapter: InvitationEmailAdapter | undefined): void {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('El adaptador de correo de pruebas solo está disponible en NODE_ENV=test.');
  }
  invitationEmailAdapter = adapter;
}

export function setCashPaymentCodeEmailAdapterForTests(adapter: CashPaymentCodeEmailAdapter | undefined): void {
  if (process.env.NODE_ENV !== 'test') throw new Error('El adaptador de correo de pruebas solo está disponible en NODE_ENV=test.');
  cashPaymentCodeEmailAdapter = adapter;
}
export function setPatientInvitationEmailAdapterForTests(adapter: PatientInvitationEmailAdapter | undefined): void {
  if (process.env.NODE_ENV !== 'test') throw new Error('El adaptador de correo de pruebas solo está disponible en NODE_ENV=test.');
  patientInvitationEmailAdapter = adapter;
}
export function setEmailVerificationAdapterForTests(adapter: EmailVerificationAdapter | undefined): void {
  if (process.env.NODE_ENV !== 'test') throw new Error('El adaptador de correo de pruebas solo está disponible en NODE_ENV=test.');
  emailVerificationAdapter = adapter;
}

export const emailService = {

  async sendPatientInvitationEmail(email: PatientInvitationEmail) {
    if (patientInvitationEmailAdapter) return patientInvitationEmailAdapter(email);
    if (process.env.NODE_ENV === 'test') return;
    const url = `${process.env.PATIENT_INVITATION_REGISTER_URL || 'http://localhost:5173/register'}?invitation=${encodeURIComponent(email.token)}`;
    await resend.emails.send({ from: FROM_EMAIL, to: email.to, subject: 'Tienes una cita en Zenda', html: `<p>Hola ${email.firstName},</p><p>Un profesional de salud registró una cita para ti en Zenda.</p><p><a href="${url}">Crea tu cuenta y verifica tu correo para ver y gestionar la cita</a>.</p><p>El enlace vence el ${email.expiresAt.toLocaleString('es-EC')}.</p>` });
  },

  async sendEmailVerificationEmail(email: EmailVerification) {
    if (emailVerificationAdapter) return emailVerificationAdapter(email);
    if (process.env.NODE_ENV === 'test') return;
    const url = `${process.env.EMAIL_VERIFICATION_URL || 'http://localhost:5173/verify-email'}?token=${encodeURIComponent(email.token)}`;
    await resend.emails.send({ from: FROM_EMAIL, to: email.to, subject: 'Verifica tu correo de Zenda', html: `<p>Hola ${email.firstName},</p><p><a href="${url}">Verificar correo</a></p>` });
  },

  async sendCashPaymentCodeEmail(email: CashPaymentCodeEmail) {
    if (cashPaymentCodeEmailAdapter) return cashPaymentCodeEmailAdapter(email);
    if (process.env.NODE_ENV === 'test') return;
    const amount = (email.amountCents / 100).toFixed(2);
    await resend.emails.send({
      from: FROM_EMAIL,
      to: email.to,
      subject: 'Código para registrar tu pago en efectivo - Zenda',
      html: `<h2>Pago en efectivo</h2><p>Presenta este código al pagar: <strong>${email.code}</strong></p><ul><li>Médico: ${email.doctorName}</li><li>Clínica: ${email.clinicName}</li><li>Servicio: ${email.serviceName}</li><li>Fecha: ${email.startsAt.toLocaleString('es-EC')}</li><li>Importe: ${email.currency} ${amount}</li></ul><p>No compartas este código fuera del consultorio.</p>`,
    });
  },

  async sendInvitationEmail(to: string, role: string, invitationToken: string, expiresAt: Date) {
    if (invitationEmailAdapter) {
      await invitationEmailAdapter({ to, role, token: invitationToken, expiresAt });
      return;
    }
    if (process.env.NODE_ENV === 'test') return;
    const invitationUrl = `${process.env.INVITATION_ACCEPT_URL || 'http://localhost:5173/accept-invitation'}?token=${encodeURIComponent(invitationToken)}`;
    const accountType = role === 'DOCTOR' ? 'médico' : 'administrador de clínica';
    await resend.emails.send({
      from: FROM_EMAIL,
      to,
      subject: 'Invitación para crear tu cuenta profesional en Zenda',
      html: `<p>Recibiste una invitación para crear una cuenta como ${accountType}.</p><p><a href="${invitationUrl}">Aceptar invitación</a></p><p>La invitación vence el ${expiresAt.toLocaleString('es-EC')}.</p>`,
    });
  },

  /**
   * Envía confirmación de cita al paciente cuando el doctor agendó directamente.
   * Incluye la clínica y banners promocionales de Zenda.
   */
  async sendDoctorAppointmentConfirmation({ to, patientName, date, time, doctorName, clinicName }: { to: string, patientName: string, date: string, time: string, doctorName: string, clinicName: string }) {
    if (process.env.NODE_ENV === 'test') return;
    try {
      const htmlContent = `
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
            <div class="greeting">Hola ${patientName},</div>
            <p style="font-size: 15px; color: #475569; margin-bottom: 20px;">
              Tu cita ha sido confirmada exitosamente. Aquí tienes los detalles:
            </p>
            
            <div class="details-card">
              <div class="detail-row">
                <span class="detail-label">Fecha:</span>
                <span class="detail-value">${date}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Hora:</span>
                <span class="detail-value">${time}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Doctor(a):</span>
                <span class="detail-value">${doctorName}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Sede:</span>
                <span class="detail-value">${clinicName}</span>
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
            © ${new Date().getFullYear()} Zenda Health. Todos los derechos reservados.<br>
            Este es un correo generado automáticamente, por favor no respondas a este mensaje.
          </div>
        </div>
      </body>
      </html>
      `;
  
      await resend.emails.send({
        from: FROM_EMAIL, 
        to,
        subject: `Confirmación de cita - ${date} a las ${time}`,
        html: htmlContent,
      });
  
      console.log(`[Email Service] Correo enviado exitosamente a ${to}.`);
    } catch (error) {
      console.error('[Email Service] Error al enviar el correo:', error);
    }
  },

  /**
   * Envía un correo de bienvenida a los nuevos usuarios.
   */
  async sendWelcomeEmail(to: string, name: string, role: string) {
    if (process.env.NODE_ENV === 'test') return;
    try {
      // Traducimos el rol, si no existe en el diccionario, ponemos 'usuario' por defecto
      const friendlyRole = roleTranslations[role] || 'usuario';

      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eaeaea; border-radius: 10px;">
          <h2 style="color: #2c3e50;">¡Bienvenido a Zenda, ${name}!</h2>
          <p style="color: #555; line-height: 1.5;">Estamos muy felices de tenerte con nosotros. Tu cuenta como <strong>${friendlyRole}</strong> ha sido creada exitosamente.</p>
          <p style="color: #555; line-height: 1.5;">Zenda es tu ecosistema de salud digital. Si tienes alguna pregunta, no dudes en contactarnos.</p>
          <hr style="border: 0; border-top: 1px solid #eaeaea; margin: 20px 0;" />
          <p style="font-size: 12px; color: #888; text-align: center;">El equipo de Zenda 🏥</p>
        </div>
      `;

      await resend.emails.send({
        from: FROM_EMAIL,
        to,
        subject: '¡Bienvenido a Zenda! 🎉',
        html,
      });
      console.log(`[EmailService] Correo de bienvenida enviado a ${to}`);
    } catch (error) {
      console.error(`[EmailService] Error enviando correo de bienvenida a ${to}:`, error);
    }
  },

  /**
   * Envía un código OTP de 6 dígitos para 2FA.
   */
  async send2FACode(to: string, code: string) {
    try {
      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eaeaea; border-radius: 10px;">
          <h2 style="color: #2c3e50;">Código de Verificación</h2>
          <p style="color: #555; line-height: 1.5;">Tu código de seguridad (OTP) para acceder a Zenda es:</p>
          <div style="background-color: #f4f6f8; padding: 15px; text-align: center; font-size: 24px; font-weight: bold; letter-spacing: 5px; border-radius: 5px; margin: 20px 0;">
            ${code}
          </div>
          <p style="color: #555; line-height: 1.5;">Este código expirará en 10 minutos. Si no solicitaste este código, puedes ignorar este correo.</p>
          <hr style="border: 0; border-top: 1px solid #eaeaea; margin: 20px 0;" />
          <p style="font-size: 12px; color: #888; text-align: center;">El equipo de Zenda 🏥</p>
        </div>
      `;

      await resend.emails.send({
        from: FROM_EMAIL,
        to,
        subject: 'Tu código de verificación Zenda 🔒',
        html,
      });
      console.log(`[EmailService] Código 2FA enviado a ${to}`);
    } catch (error) {
      console.error(`[EmailService] Error enviando 2FA a ${to}:`, error);
    }
  },

  /**
   * Envía instrucciones para restablecer contraseña.
   */
  async sendPasswordReset(to: string, resetToken: string) {
    try {
      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eaeaea; border-radius: 10px;">
          <h2 style="color: #2c3e50;">Recuperación de Contraseña</h2>
          <p style="color: #555; line-height: 1.5;">Hemos recibido una solicitud para restablecer tu contraseña en Zenda.</p>
          <p style="color: #555; line-height: 1.5;">Utiliza el siguiente token para recuperar tu acceso:</p>
          <div style="background-color: #f4f6f8; padding: 15px; text-align: center; font-size: 18px; font-weight: bold; word-break: break-all; border-radius: 5px; margin: 20px 0;">
            ${resetToken}
          </div>
          <p style="color: #555; line-height: 1.5;">Si no fuiste tú quien solicitó este cambio, ponte en contacto con soporte inmediatamente.</p>
          <hr style="border: 0; border-top: 1px solid #eaeaea; margin: 20px 0;" />
          <p style="font-size: 12px; color: #888; text-align: center;">El equipo de Zenda 🏥</p>
        </div>
      `;

      await resend.emails.send({
        from: FROM_EMAIL,
        to,
        subject: 'Recuperación de contraseña - Zenda 🔑',
        html,
      });
      console.log(`[EmailService] Correo de recuperación enviado a ${to}`);
    } catch (error) {
      console.error(`[EmailService] Error enviando correo de recuperación a ${to}:`, error);
    }
  },

  /**
   * Envía recordatorio 24h para citas pagadas o gratuitas (CARD o NONE)
   */
  async sendCardReminderEmail(to: string, doctorName: string, date: string, time: string) {
    try {
      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eaeaea; border-radius: 10px;">
          <h2 style="color: #2c3e50;">Recordatorio de tu Cita ⏰</h2>
          <p style="color: #555; line-height: 1.5;">Hola, te recordamos amablemente que mañana <strong>${date}</strong> a las <strong>${time}</strong> tienes una cita confirmada con el Dr./Dra. <strong>${doctorName}</strong>.</p>
          <p style="color: #555; line-height: 1.5;">Tu cita ya está asegurada. ¡Te esperamos!</p>
          <hr style="border: 0; border-top: 1px solid #eaeaea; margin: 20px 0;" />
          <p style="font-size: 12px; color: #888; text-align: center;">El equipo de Zenda 🏥</p>
        </div>
      `;

      await resend.emails.send({
        from: FROM_EMAIL,
        to,
        subject: `Recordatorio: Cita mañana con ${doctorName}`,
        html,
      });
      console.log(`[EmailService] Recordatorio CARD enviado a ${to}`);
    } catch (error) {
      console.error(`[EmailService] Error enviando recordatorio a ${to}:`, error);
    }
  },

  /**
   * Envía recordatorio 24h para citas en efectivo (CASH) exigiendo confirmación
   */
  async sendCashConfirmationPromptEmail(to: string, doctorName: string, date: string, time: string) {
    try {
      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eaeaea; border-radius: 10px;">
          <h2 style="color: #2c3e50;">¡Confirma tu Cita para Mañana! ⚠️</h2>
          <p style="color: #555; line-height: 1.5;">Hola, tienes un turno reservado para mañana <strong>${date}</strong> a las <strong>${time}</strong> con el Dr./Dra. <strong>${doctorName}</strong>.</p>
          <p style="color: #555; line-height: 1.5;">Al ser un pago en clínica, necesitamos que confirmes tu asistencia desde la app para no perder tu turno.</p>
          <p style="color: #e74c3c; font-weight: bold; line-height: 1.5;">Si no confirmas tu cita a más tardar 12 horas antes, el turno será liberado automáticamente.</p>
          <hr style="border: 0; border-top: 1px solid #eaeaea; margin: 20px 0;" />
          <p style="font-size: 12px; color: #888; text-align: center;">El equipo de Zenda 🏥</p>
        </div>
      `;

      await resend.emails.send({
        from: FROM_EMAIL,
        to,
        subject: `Acción Requerida: Confirma tu cita con ${doctorName}`,
        html,
      });
      console.log(`[EmailService] Prompt de confirmación CASH enviado a ${to}`);
    } catch (error) {
      console.error(`[EmailService] Error enviando prompt de confirmación a ${to}:`, error);
    }
  },

  /**
   * Envía aviso de cancelación automática a las 12 horas
   */
  async sendCancellationNoticeEmail(to: string, doctorName: string, time: string) {
    try {
      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eaeaea; border-radius: 10px;">
          <h2 style="color: #e74c3c;">Aviso de Cancelación de Cita</h2>
          <p style="color: #555; line-height: 1.5;">Hola, lamentamos informarte que tu cita con el Dr./Dra. <strong>${doctorName}</strong> programada a las <strong>${time}</strong> ha sido cancelada.</p>
          <p style="color: #555; line-height: 1.5;">Debido a que no recibimos la confirmación requerida faltando 12 horas para el turno, hemos tenido que liberar el espacio para otros pacientes.</p>
          <p style="color: #555; line-height: 1.5;">Esperamos poder atenderte en una próxima oportunidad. Puedes reagendar desde nuestra app.</p>
          <hr style="border: 0; border-top: 1px solid #eaeaea; margin: 20px 0;" />
          <p style="font-size: 12px; color: #888; text-align: center;">El equipo de Zenda 🏥</p>
        </div>
      `;

      await resend.emails.send({
        from: FROM_EMAIL,
        to,
        subject: `Tu cita ha sido liberada - Zenda`,
        html,
      });
      console.log(`[EmailService] Aviso de cancelación automática enviado a ${to}`);
    } catch (error) {
      console.error(`[EmailService] Error enviando aviso de cancelación a ${to}:`, error);
    }
  },

  /**
   * Envía confirmación de cita al paciente (incluyendo PIN si es pago en efectivo)
   */
  async sendAppointmentConfirmation(to: string, patientName: string, doctorName: string, date: string, time: string, turnNumber: number, isCash: boolean, pin?: string | null) {
    if (process.env.NODE_ENV === 'test') return;
    try {
      const pinHtml = isCash && pin 
        ? `<div style="background-color: #fdf2e9; padding: 15px; border-left: 4px solid #e67e22; margin: 20px 0;">
             <h3 style="color: #d35400; margin-top: 0;">Tu PIN de Confirmación: <span style="font-size: 24px; letter-spacing: 2px;">${pin}</span></h3>
             <p style="color: #555; margin-bottom: 0;">Presenta este código en recepción para confirmar tu pago en efectivo.</p>
           </div>` 
        : '';

      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eaeaea; border-radius: 10px;">
          <h2 style="color: #2c3e50;">¡Cita Reservada con Éxito! 🎉</h2>
          <p style="color: #555; line-height: 1.5;">Hola ${patientName}, tu reserva ha sido procesada correctamente.</p>
          <ul style="color: #555; line-height: 1.5; background-color: #f9f9f9; padding: 15px 30px; border-radius: 5px;">
            <li><strong>Doctor(a):</strong> ${doctorName}</li>
            <li><strong>Fecha:</strong> ${date}</li>
            <li><strong>Hora:</strong> ${time}</li>
            <li><strong>Turno Asignado:</strong> #${turnNumber}</li>
          </ul>
          ${pinHtml}
          <p style="color: #555; line-height: 1.5;">Gracias por confiar en Zenda para tu salud.</p>
          <hr style="border: 0; border-top: 1px solid #eaeaea; margin: 20px 0;" />
          <p style="font-size: 12px; color: #888; text-align: center;">El equipo de Zenda 🏥</p>
        </div>
      `;

      await resend.emails.send({
        from: FROM_EMAIL,
        to,
        subject: `Confirmación de Cita - Zenda`,
        html,
      });
      console.log(`[EmailService] Confirmación de cita enviada a ${to}`);
    } catch (error) {
      console.error(`[EmailService] Error enviando confirmación a ${to}:`, error);
    }
  },

  /**
   * Envía notificación de nueva cita al doctor
   */
  async sendDoctorNewBooking(to: string, doctorName: string, patientName: string, date: string, time: string, serviceName: string) {
    if (process.env.NODE_ENV === 'test') return;
    try {
      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eaeaea; border-radius: 10px;">
          <h2 style="color: #2c3e50;">Nueva Cita Agendada 📅</h2>
          <p style="color: #555; line-height: 1.5;">Hola Dr./Dra. ${doctorName}, tienes un nuevo paciente en tu agenda.</p>
          <ul style="color: #555; line-height: 1.5; background-color: #f4f6f8; padding: 15px 30px; border-radius: 5px;">
            <li><strong>Paciente:</strong> ${patientName}</li>
            <li><strong>Fecha:</strong> ${date}</li>
            <li><strong>Hora:</strong> ${time}</li>
            <li><strong>Servicio:</strong> ${serviceName}</li>
          </ul>
          <p style="color: #555; line-height: 1.5;">Puedes revisar los detalles completos en tu panel de control.</p>
          <hr style="border: 0; border-top: 1px solid #eaeaea; margin: 20px 0;" />
          <p style="font-size: 12px; color: #888; text-align: center;">El equipo de Zenda 🏥</p>
        </div>
      `;

      await resend.emails.send({
        from: FROM_EMAIL,
        to,
        subject: `Nueva cita agendada: ${patientName}`,
        html,
      });
      console.log(`[EmailService] Notificación a doctor enviada a ${to}`);
    } catch (error) {
      console.error(`[EmailService] Error notificando al doctor en ${to}:`, error);
    }
  }
};
