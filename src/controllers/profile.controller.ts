import { Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import prisma from '../prisma';
import { ImageValidationError, imageService, inspectImage, profileImageUrls } from '../services/image.service';

export const uploadDoctorPhoto = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'No autorizado' });

    if (!req.file) {
      return res.status(400).json({ error: 'No se subió ningún archivo' });
    }

    const doctorProfile = await prisma.doctorProfile.findUnique({ where: { userId } });
    if (!doctorProfile) return res.status(404).json({ error: 'Perfil de doctor no encontrado' });

    const inspected = inspectImage(req.file.buffer);
    if (inspected.mime !== req.file.mimetype) {
      return res.status(422).json({ error: 'IMAGE_CONTENT_TYPE_MISMATCH', message: 'El contenido de la imagen no coincide con su tipo declarado.' });
    }
    const uploaded = await imageService.uploadProfileImage(req.file.buffer, `zenda/doctors/${doctorProfile.id}/profile`);

    // Actualizar Base de Datos
    await prisma.doctorProfile.update({
      where: { id: doctorProfile.id },
      data: { profileImageUrl: uploaded.secureUrl }
    });
    void imageService.deleteReplacedProfileImage(doctorProfile.profileImageUrl, uploaded.publicId).catch((cleanupError) => {
      console.warn('[Profile Controller] No se pudo limpiar la imagen reemplazada:', cleanupError instanceof Error ? cleanupError.message : cleanupError);
    });
    const urls = profileImageUrls(uploaded.secureUrl)!;
    res.status(200).json({ message: 'Foto de perfil actualizada', profileImageUrl: uploaded.secureUrl, profileImageUrls: urls });
  } catch (error: unknown) {
    if (error instanceof ImageValidationError) return res.status(422).json({ error: error.code, message: error.message });
    console.error('[Profile Controller] Error en uploadDoctorPhoto:', error);
    res.status(500).json({ error: 'Error interno al procesar la imagen' });
  }
};

export const uploadPortfolioImage = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'No autorizado' });

    if (!req.file) {
      return res.status(400).json({ error: 'No se subió ningún archivo' });
    }

    const doctorProfile = await prisma.doctorProfile.findUnique({ where: { userId } });
    if (!doctorProfile) return res.status(404).json({ error: 'Perfil de doctor no encontrado' });

    // Subir a Cloudinary
    const secureUrl = await imageService.uploadImage(req.file.buffer, `zenda/doctors/${doctorProfile.id}/portfolio`);

    // Actualizar Base de Datos
    const updatedProfile = await prisma.doctorProfile.update({
      where: { id: doctorProfile.id },
      data: {
        portfolioImages: {
          push: secureUrl
        }
      }
    });

    res.status(200).json({ message: 'Imagen añadida al portafolio', url: secureUrl });
  } catch (error: any) {
    console.error('[Profile Controller] Error en uploadPortfolioImage:', error);
    res.status(500).json({ error: 'Error interno al procesar la imagen del portafolio' });
  }
};

export const uploadClinicLogo = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'No autorizado' });

    if (!req.file) {
      return res.status(400).json({ error: 'No se subió ningún archivo' });
    }

    const clinicProfile = await prisma.clinicProfile.findUnique({ where: { userId } });
    if (!clinicProfile) return res.status(404).json({ error: 'Perfil de clínica no encontrado' });

    // Subir a Cloudinary
    const secureUrl = await imageService.uploadImage(req.file.buffer, `zenda/clinics/${clinicProfile.id}/logo`);

    // Actualizar Base de Datos
    const updatedProfile = await prisma.clinicProfile.update({
      where: { id: clinicProfile.id },
      data: { logoUrl: secureUrl }
    });

    res.status(200).json({ message: 'Logo de clínica actualizado', logoUrl: secureUrl });
  } catch (error: any) {
    console.error('[Profile Controller] Error en uploadClinicLogo:', error);
    res.status(500).json({ error: 'Error interno al procesar el logo de la clínica' });
  }
};
