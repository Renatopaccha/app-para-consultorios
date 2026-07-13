import prisma from '../src/prisma';
import bcrypt from 'bcrypt';

async function main() {
    console.log('🌱 Iniciando la siembra de datos de Zenda...');

    const adminEmail = process.env.SEED_SUPER_ADMIN_EMAIL?.trim().toLowerCase();
    const adminPassword = process.env.SEED_SUPER_ADMIN_PASSWORD;
    if (adminEmail || adminPassword) {
        if (!adminEmail || !adminPassword || adminPassword.length < 12) {
            throw new Error('SEED_SUPER_ADMIN_EMAIL y una contraseña de al menos 12 caracteres son requeridos juntos.');
        }
        const passwordHash = await bcrypt.hash(adminPassword, 12);
        await prisma.user.upsert({
            where: { email: adminEmail },
            update: { role: 'SUPER_ADMIN', passwordHash },
            create: {
                email: adminEmail,
                passwordHash,
                firstName: 'Administrador',
                lastName: 'Zenda',
                role: 'SUPER_ADMIN',
            },
        });
        console.log('✅ Superadministrador de desarrollo preparado.');
    }

    // 1. Catálogo de Seguros Médicos
    const insurances = [
        'Privado / Particular',
        'IESS',
        'SaludSA',
        'BMI',
        'Bupa',
        'Humana',
        'Ecuasanitas',
        'Red Pública Integral de Salud (MSP)'
    ];

    for (const name of insurances) {
        await prisma.insurance.upsert({
            where: { name },
            update: {},
            create: { name },
        });
    }
    console.log('✅ Seguros médicos cargados.');

    // 2. Catálogo Maestro de Especialidades y Subespecialidades
    const specialties = [
        'Medicina General',
        'Odontología General', 'Ortodoncia', 'Endodoncia', 'Periodoncia', 'Odontopediatría', 'Cirugía Maxilofacial', 'Rehabilitación Oral / Prostodoncia',
        // Especialidades Clínicas
        'Cardiología', 'Cardiología intervencionista', 'Electrofisiología', 'Insuficiencia cardíaca',
        'Alergia e Inmunología',
        'Dermatología', 'Dermatología pediátrica', 'Dermatopatología', 'Cirugía dermatológica',
        'Endocrinología', 'Diabetes', 'Endocrinología reproductiva', 'Endocrinología pediátrica',
        'Gastroenterología', 'Hepatología', 'Endoscopia terapéutica', 'Gastroenterología pediátrica',
        'Geriatría',
        'Hematología', 'Hematología oncológica', 'Hemato-pediatría',
        'Infectología',
        'Medicina de Emergencia / Urgencias',
        'Medicina Familiar y Comunitaria',
        'Medicina Interna', 'Reumatología', 'Neumología', 'Nefrología', 'Oncología Médica',
        'Neurología', 'Epilepsia', 'Neurología vascular', 'Neuroinmunología',
        'Pediatría', 'Neonatología', 'Cardiología pediátrica', 'Oncología pediátrica',
        'Psiquiatría', 'Psiquiatría infantil y de la adolescencia', 'Psiquiatría geriátrica', 'Medicina de la adicción',

        // Especialidades Quirúrgicas
        'Cirugía General', 'Cirugía oncológica', 'Cirugía bariátrica y metabólica', 'Cirugía de trauma',
        'Cirugía Cardiovascular',
        'Neurocirugía',
        'Cirugía Oral y Maxilofacial',
        'Cirugía Pediátrica',
        'Cirugía Plástica, Estética y Reparadora',
        'Cirugía Torácica',
        'Ginecología y Obstetricia', 'Medicina materno-fetal', 'Oncología ginecológica',
        'Oftalmología',
        'Otorrinolaringología',
        'Traumatología y Ortopedia', 'Cirugía de columna', 'Medicina deportiva', 'Reemplazos articulares',
        'Urología', 'Urología pediátrica', 'Urología oncológica', 'Andrología',

        // Especialidades Diagnósticas y de Laboratorio
        'Anatomía Patológica',
        'Radiología', 'Radiología intervencionista', 'Neurorradiología', 'Radiología pediátrica',
        'Análisis Clínicos / Patología Clínica',
        'Medicina Nuclear',

        // Otras Especialidades
        'Anestesiología', 'Medicina del dolor', 'Cuidados paliativos', 'Cuidados críticos',
        'Genética Médica',
        'Medicina Física y Rehabilitación',
        'Medicina Legal y Forense',
        'Medicina Preventiva y Salud Pública',
        'Medicina del Trabajo / Ocupacional'
    ];

    for (const name of specialties) {
        await prisma.specialty.upsert({
            where: { name },
            update: {},
            create: { name },
        });
    }
    console.log(`✅ ${specialties.length} especialidades y subespecialidades cargadas.`);
}

main()
    .catch((e) => {
        console.error('❌ Error en la siembra:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
