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

export const emailService = {
  /**
   * Envía un correo de bienvenida a los nuevos usuarios.
   */
  async sendWelcomeEmail(to: string, name: string, role: string) {
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
  }
};