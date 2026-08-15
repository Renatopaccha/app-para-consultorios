import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware';
import {
  addCredential,
  bootstrap,
  editCredential,
  languages,
  professions,
  removeCredential,
  saveIdentity,
  saveLocation,
  saveProfile,
  saveProgress,
  saveSpecialties,
  specialties,
  start,
  submit,
} from '../controllers/professionalOnboarding.controller';
import {
  deleteAsset,
  deleteCredentialDocument,
  getAssetAccess,
  getCredentialDocumentAccess,
  uploadAsset,
  uploadCredentialDocument,
  reorderAssets,
} from '../controllers/professionalOnboardingUpload.controller';
import {
  handleProfessionalOnboardingUploadError,
  professionalOnboardingUpload,
  professionalOnboardingUploadRateLimit,
} from '../middlewares/professionalOnboardingUpload.middleware';

const router = Router();

// Onboarding creates professional eligibility; it must never require DOCTOR.
router.use(authenticate);
router.get('/', bootstrap);
router.post('/start', start);
router.get('/catalog/professions', professions);
router.get('/catalog/specialties', specialties);
router.get('/catalog/languages', languages);
router.patch('/identity', saveIdentity);
router.put('/specialties', saveSpecialties);
router.post('/credentials', addCredential);
router.put('/credentials/:credentialId', editCredential);
router.delete('/credentials/:credentialId', removeCredential);
router.put('/location', saveLocation);
router.put('/profile', saveProfile);
router.patch('/progress', saveProgress);
router.post('/assets', professionalOnboardingUploadRateLimit, professionalOnboardingUpload, handleProfessionalOnboardingUploadError, uploadAsset);
router.put('/assets/order', reorderAssets);
router.get('/assets/:assetId/access', getAssetAccess);
router.delete('/assets/:assetId', deleteAsset);
router.post('/credentials/:credentialId/documents', professionalOnboardingUploadRateLimit, professionalOnboardingUpload, handleProfessionalOnboardingUploadError, uploadCredentialDocument);
router.get('/credentials/:credentialId/documents/:documentId/access', getCredentialDocumentAccess);
router.delete('/credentials/:credentialId/documents/:documentId', deleteCredentialDocument);
router.post('/submit', submit);

export default router;
