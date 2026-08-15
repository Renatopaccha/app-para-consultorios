import { getProfessionalAuthMode } from './professionalAuthorization';

describe('PROFESSIONAL_AUTH_ENFORCEMENT_MODE', () => {
  it.each(['legacy', 'shadow', 'enforce'] as const)('acepta %s', (mode) => {
    expect(getProfessionalAuthMode({ PROFESSIONAL_AUTH_ENFORCEMENT_MODE: mode } as NodeJS.ProcessEnv)).toBe(mode);
  });

  it('usa legacy por default y rechaza valores inválidos', () => {
    expect(getProfessionalAuthMode({} as NodeJS.ProcessEnv)).toBe('legacy');
    expect(() => getProfessionalAuthMode({ PROFESSIONAL_AUTH_ENFORCEMENT_MODE: 'off' } as NodeJS.ProcessEnv))
      .toThrow('PROFESSIONAL_AUTH_ENFORCEMENT_MODE inválido');
  });
});
