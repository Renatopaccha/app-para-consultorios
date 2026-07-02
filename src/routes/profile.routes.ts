import { Router } from 'express';
import multer from 'multer';
import { 
  uploadDoctorPhoto, 
  uploadPortfolioImage, 
  uploadClinicLogo 
} from '../controllers/profile.controller';
import { authenticate, requireRole } from '../middlewares/auth.middleware';

const router = Router();

// Configuración de Multer
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // Límite de 5MB
  },
  fileFilter: (req, file, cb) => {
    // 1. Corrección: Seguridad (File Filter)
    const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Formato de archivo no soportado. Solo se permite JPEG, PNG o WEBP.'));
    }
  }
});

// Capturamos los errores de Multer para que no crasheen el servidor
const handleUploadError = (err: any, req: any, res: any, next: any) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'El archivo excede el límite de 5MB' });
    }
    return res.status(400).json({ error: `Error de carga: ${err.message}` });
  } else if (err) {
    return res.status(400).json({ error: err.message });
  }
  next();
};

// --- Rutas ---
router.post(
  '/doctor/photo',
  authenticate,
  requireRole(['DOCTOR']),
  upload.single('image'),
  handleUploadError,
  uploadDoctorPhoto
);

router.post(
  '/doctor/portfolio',
  authenticate,
  requireRole(['DOCTOR']),
  upload.single('image'),
  handleUploadError,
  uploadPortfolioImage
);

router.post(
  '/clinic/logo',
  authenticate,
  requireRole(['CLINIC_ADMIN']),
  upload.single('image'),
  handleUploadError,
  uploadClinicLogo
);

export default router;
