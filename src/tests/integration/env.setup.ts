import dotenv from 'dotenv';

// Load only the isolated integration environment before application modules.
dotenv.config({ path: '.env.test' });
