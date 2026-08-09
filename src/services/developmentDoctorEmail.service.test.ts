import { assertLocalDevelopmentExecution } from './developmentDoctorEmail.service';

describe('development doctor email CLI guard', () => {
  const localDevelopment = {
    NODE_ENV: 'development',
    DATABASE_URL: 'postgresql://local:local@localhost:5432/zenda_development',
  } as NodeJS.ProcessEnv;

  it('accepts only an explicit local development configuration', () => {
    expect(() => assertLocalDevelopmentExecution(localDevelopment)).not.toThrow();
  });

  it.each([
    { ...localDevelopment, NODE_ENV: 'production' },
    { ...localDevelopment, NODE_ENV: 'test' },
    { ...localDevelopment, DATABASE_URL: 'postgresql://local:local@production.example.test:5432/zenda' },
    { ...localDevelopment, DATABASE_URL: 'postgresql://local:local@localhost:5432/zenda_production' },
  ])('rejects a non-development or unsafe database configuration', (environment) => {
    expect(() => assertLocalDevelopmentExecution(environment)).toThrow();
  });
});
