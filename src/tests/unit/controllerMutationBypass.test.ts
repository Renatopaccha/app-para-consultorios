import fs from 'fs';
import path from 'path';

const controllersDirectory = path.resolve(__dirname, '../../controllers');
const forbidden = [
  'prisma.appointment.create(',
  'prisma.appointment.update(',
  'prisma.appointment.updateMany(',
  'prisma.appointment.upsert(',
  'prisma.appointmentTurn.create(',
  'prisma.appointmentTurn.update(',
];

function controllerFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? controllerFiles(path.join(directory, entry.name)) : entry.name.endsWith('.ts') ? [path.join(directory, entry.name)] : []);
}

describe('controller appointment mutation boundary', () => {
  it('keeps appointment and turn mutations inside domain services', () => {
    const violations = controllerFiles(controllersDirectory).flatMap(file => {
      const source = fs.readFileSync(file, 'utf8');
      return forbidden.filter(pattern => source.includes(pattern)).map(pattern => `${path.basename(file)}: ${pattern}`);
    });
    expect(violations).toEqual([]);
  });
});
