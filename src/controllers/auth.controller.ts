import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import prisma from '../prisma';
import { generateToken } from '../utils/jwt';

export const registerPatient = async (req: Request, res: Response) => {
  try {
    const { email, password, firstName, lastName, phone } = req.body;

    if (!email || !password || !firstName || !lastName || !phone) {
      return res.status(400).json({ error: 'Faltan campos obligatorios para el registro' });
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ error: 'El email ya está registrado' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const newUser = await prisma.user.create({
      data: {
        email,
        passwordHash,
        firstName,
        lastName,
        phone,
        role: 'PATIENT',
      },
    });

    const token = generateToken({ id: newUser.id, role: newUser.role });

    const { passwordHash: _, ...userWithoutPassword } = newUser;

    res.status(201).json({ user: userWithoutPassword, token });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al registrar el paciente' });
  }
};

export const registerClinic = async (req: Request, res: Response) => {
  try {
    const { email, password, firstName, lastName, phone, name, address } = req.body;

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      res.status(400).json({ error: 'El email ya está registrado' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);

    // Usamos una transacción de Prisma para garantizar atomicidad
    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          passwordHash,
          firstName,
          lastName,
          phone,
          role: 'CLINIC_ADMIN',
        },
      });

      const clinic = await tx.clinic.create({
        data: {
          name,
          address,
        },
      });

      return { user, clinic };
    });

    const token = generateToken({ id: result.user.id, role: result.user.role });
    const { passwordHash: _, ...userWithoutPassword } = result.user;

    res.status(201).json({ user: userWithoutPassword, clinic: result.clinic, token });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al registrar la clínica' });
  }
};

export const login = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.passwordHash) {
      res.status(401).json({ error: 'Credenciales inválidas' });
      return;
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      res.status(401).json({ error: 'Credenciales inválidas' });
      return;
    }

    const token = generateToken({ id: user.id, role: user.role });
    const { passwordHash: _, ...userWithoutPassword } = user;

    res.status(200).json({ user: userWithoutPassword, token });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al iniciar sesión' });
  }
};

export const registerDoctor = async (req: Request, res: Response) => {
  try {
    const { email, password, firstName, lastName, phone, licenseNumber, consultationPrice, clinicId } = req.body;

    // Ya no exigimos licenseNumber ni consultationPrice, pero sí los campos básicos
    if (!email || !password || !firstName || !lastName) {
      return res.status(400).json({ error: 'Faltan campos obligatorios (email, password, firstName, lastName)' });
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ error: 'El email ya está registrado' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          passwordHash,
          firstName,
          lastName,
          phone,
          role: 'DOCTOR',
        },
      });

      const doctor = await tx.doctor.create({
        data: {
          // Si no envía número de licencia, generamos uno temporal
          licenseNumber: licenseNumber || `TEMP-${Date.now()}`,
          // Si no envía precio, por defecto es 0
          consultationPrice: consultationPrice ? Number(consultationPrice) : 0,
          userId: user.id,
          clinicId: clinicId || null
        },
      });

      return { user, doctor };
    });

    const token = generateToken({ id: result.user.id, role: result.user.role });
    const { passwordHash: _, ...userWithoutPassword } = result.user;

    res.status(201).json({ user: userWithoutPassword, doctor: result.doctor, token });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al registrar el doctor' });
  }
};
