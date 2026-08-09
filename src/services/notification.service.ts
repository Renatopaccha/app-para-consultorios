import nodemailer from 'nodemailer';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';

// 1. Configuración de Firebase Admin usando archivo local JSON
if (!getApps().length) {
  try {
    // Intentamos cargar las credenciales desde el archivo local
    const serviceAccount = require('../config/firebase-admin.json');
    
    initializeApp({
      credential: cert(serviceAccount)
    });
    console.log('[NotificationService] Firebase Admin inicializado correctamente con firebase-admin.json');
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'MODULE_NOT_FOUND') {
      console.warn('[NotificationService] ADVERTENCIA: El archivo src/config/firebase-admin.json no fue encontrado. Las notificaciones Push no funcionarán.');
    } else {
      console.error('[NotificationService] Error inicializando Firebase Admin:', error);
    }
  }
}

// 2. Configuración de Nodemailer (SMTP)
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_SECURE === 'true', // true para 465, false para otros puertos
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export const notificationService = {
  /**
   * Envía un correo electrónico.
   * @param to Destinatario
   * @param subject Asunto del correo
   * @param html Contenido HTML
   */
  async sendEmail(to: string, subject: string, html: string, deliveryKey?: string) {
    try {
      const info = await transporter.sendMail({
        from: `"Vitali 🏥" <${process.env.SMTP_USER}>`,
        to,
        subject,
        html,
        ...(deliveryKey ? { messageId: `<${deliveryKey}@notifications.zenda.local>` } : {}),
      });
      console.log(JSON.stringify({ event: 'notification_channel_sent', channel: 'EMAIL', messageId: info.messageId }));
      return true;
    } catch (error) {
      console.error(JSON.stringify({ event: 'notification_channel_failed', channel: 'EMAIL', error: error instanceof Error ? error.name : 'UnknownError' }));
      return false; // Evitamos romper el flujo principal si el correo falla
    }
  },

  /**
   * Envía una notificación Push a través de Firebase Cloud Messaging (FCM).
   * @param fcmToken El token del dispositivo (FCM Token) guardado en la tabla User
   * @param title Título de la notificación
   * @param body Cuerpo o mensaje de la notificación
   */
  async sendPushNotification(fcmToken: string, title: string, body: string) {
    if (!fcmToken) return false;

    try {
      const message = {
        notification: {
          title,
          body,
        },
        token: fcmToken,
      };

      const response = await getMessaging().send(message);
      console.log(`[NotificationService] Push enviado exitosamente. MessageId: ${response}`);
      return true;
    } catch (error) {
      console.error('[NotificationService] Error enviando push:', error);
      return false; // Evitamos romper el flujo principal
    }
  }
};
