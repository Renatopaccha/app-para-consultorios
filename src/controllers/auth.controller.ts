import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import prisma from '../prisma';
import { generateToken } from '../utils/jwt';

export const registerPatient = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password, firstName, lastName, phone } = req.body;

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      res.status(400).json({ error: 'El email ya está registrado' });
      return;
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

export const registerClinic = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password, firstName, lastName, phone, clinicName, clinicAddress } = req.body;

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
          name: clinicName,
          address: clinicAddress,
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

export const login = async (req: Request, res: Response): Promise<void> => {
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
