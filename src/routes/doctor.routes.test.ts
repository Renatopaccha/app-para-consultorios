import express, { type RequestHandler } from 'express';
import request from 'supertest';

const mockGetDoctorById = jest.fn((req, res, _next) => res.status(200).json({ handler: 'doctor-by-id', id: req.params.id })) as jest.MockedFunction<RequestHandler>;
const mockCreateGuestPatient = jest.fn((_req, res, _next) => res.status(201).json({ handler: 'guest' })) as jest.MockedFunction<RequestHandler>;
const mockSearchPatients = jest.fn((_req, res, _next) => res.status(200).json({ handler: 'search' })) as jest.MockedFunction<RequestHandler>;
const mockAuthenticate = jest.fn((_req, _res, next) => next()) as jest.MockedFunction<RequestHandler>;
const mockRoleObservations: Array<{ path: string; roles: string[] }> = [];

const emptyHandler: RequestHandler = (_req, res) => res.status(200).json({ handler: 'other' });

jest.mock('../controllers/doctor.controller', () => ({
  getDoctors: emptyHandler,
  getDoctorById: mockGetDoctorById,
  createDoctor: emptyHandler,
  getMyAppointments: emptyHandler,
  updateDoctorProfile: emptyHandler,
  addService: emptyHandler,
  addWorkSchedule: emptyHandler,
  getMySchedules: emptyHandler,
  addAppointment: emptyHandler,
  createGuestPatient: mockCreateGuestPatient,
  searchPatients: mockSearchPatients,
}));
jest.mock('../controllers/doctorManagement.controller', () => ({
  createMyDoctorService: emptyHandler,
  getMyDoctorProfile: emptyHandler,
  getMyDoctorWorkspaces: emptyHandler,
  listMyDoctorServices: emptyHandler,
  patchMyDoctorProfile: emptyHandler,
  patchMyDoctorService: emptyHandler,
  patchMyDoctorServiceStatus: emptyHandler,
}));
jest.mock('../controllers/doctorSchedule.controller', () => ({
  correctInvitedPatientEmail: emptyHandler,
  createMyAppointment: emptyHandler,
  getMyWorkSchedules: emptyHandler,
  putMyWorkSchedules: emptyHandler,
}));
jest.mock('../controllers/doctorDashboard.controller', () => ({ getMyDoctorDashboardSummary: emptyHandler }));
jest.mock('../controllers/review.controller', () => ({ getMyDoctorReviews: emptyHandler }));
jest.mock('../controllers/certification.controller', () => ({
  deleteMyCertification: emptyHandler,
  getMyCertifications: emptyHandler,
  handleCertificationUploadError: emptyHandler,
  patchMyCertification: emptyHandler,
  postMyCertification: emptyHandler,
  postSubmitCertification: emptyHandler,
  certificationUpload: emptyHandler,
}));
jest.mock('../middlewares/auth.middleware', () => ({
  authenticate: mockAuthenticate,
  requireRole: (roles: string[]): RequestHandler => (req, _res, next) => {
    mockRoleObservations.push({ path: req.path, roles });
    next();
  },
}));
jest.mock('express-rate-limit', () => ({ rateLimit: () => emptyHandler }));

import doctorRoutes from './doctor.routes';

const app = express();
app.use(express.json());
app.use('/api/doctors', doctorRoutes);

describe('precedencia del router de doctors', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRoleObservations.length = 0;
  });

  it('POST /patients/guest llega al handler guest y conserva authenticate + DOCTOR', async () => {
    const response = await request(app).post('/api/doctors/patients/guest').send({}).expect(201);

    expect(response.body).toEqual({ handler: 'guest' });
    expect(mockCreateGuestPatient).toHaveBeenCalledTimes(1);
    expect(mockGetDoctorById).not.toHaveBeenCalled();
    expect(mockAuthenticate).toHaveBeenCalledTimes(1);
    expect(mockRoleObservations).toEqual([{ path: '/patients/guest', roles: ['DOCTOR'] }]);
  });

  it('GET /patients/search llega al handler search y no interpreta search como :id', async () => {
    const response = await request(app).get('/api/doctors/patients/search').expect(200);

    expect(response.body).toEqual({ handler: 'search' });
    expect(mockSearchPatients).toHaveBeenCalledTimes(1);
    expect(mockGetDoctorById).not.toHaveBeenCalled();
    expect(mockAuthenticate).toHaveBeenCalledTimes(1);
    expect(mockRoleObservations).toEqual([{ path: '/patients/search', roles: ['DOCTOR'] }]);
  });

  it('GET /:id continúa llegando al handler de doctor por ID sin middleware añadido', async () => {
    const response = await request(app).get('/api/doctors/doctor-valid-id').expect(200);

    expect(response.body).toEqual({ handler: 'doctor-by-id', id: 'doctor-valid-id' });
    expect(mockGetDoctorById).toHaveBeenCalledTimes(1);
    expect(mockCreateGuestPatient).not.toHaveBeenCalled();
    expect(mockSearchPatients).not.toHaveBeenCalled();
    expect(mockAuthenticate).not.toHaveBeenCalled();
    expect(mockRoleObservations).toEqual([]);
  });
});
