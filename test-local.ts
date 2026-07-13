import * as dotenv from 'dotenv';
dotenv.config();
import { generateToken } from './src/utils/jwt';
console.log(generateToken({ id: 'dummy-user-id', role: 'DOCTOR' }));
