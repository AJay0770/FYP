require('dotenv').config();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const issueToken = (user) =>
  jwt.sign({ userId: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '24h' });

async function clearTables() {
  // Delete child tables before parent tables to respect FK constraints.
  await prisma.report.deleteMany();
  await prisma.safetyAlert.deleteMany();
  await prisma.camera.deleteMany();
  await prisma.chatMessage.deleteMany();
  await prisma.materialEntry.deleteMany();
  await prisma.siteUpdate.deleteMany();
  await prisma.attendanceRecord.deleteMany();
  await prisma.worker.deleteMany();
  await prisma.projectEngineer.deleteMany();
  await prisma.subscription.deleteMany();
  await prisma.project.deleteMany();
  await prisma.user.deleteMany();
}

async function main() {
  console.log('Clearing existing data...');
  await clearTables();

  const passwordHash = await bcrypt.hash('password123', 12);

  console.log('Creating users...');
  const admin = await prisma.user.create({
    data: { name: 'Admin User', email: 'admin@test.com', passwordHash, role: 'ADMIN' },
  });

  const engineer1 = await prisma.user.create({
    data: { name: 'Engineer One', email: 'engineer1@test.com', passwordHash, role: 'ENGINEER' },
  });

  const engineer2 = await prisma.user.create({
    data: { name: 'Engineer Two', email: 'engineer2@test.com', passwordHash, role: 'ENGINEER' },
  });

  const client1 = await prisma.user.create({
    data: { name: 'Client One', email: 'client1@test.com', passwordHash, role: 'CLIENT' },
  });

  const client2 = await prisma.user.create({
    data: { name: 'Client Two', email: 'client2@test.com', passwordHash, role: 'CLIENT' },
  });

  console.log('Creating projects...');
  const project1 = await prisma.project.create({
    data: {
      name: 'Riverside Tower',
      gpsLat: 40.7128,
      gpsLng: -74.006,
      address: '123 Riverside Dr, New York, NY',
      clientId: client1.id,
      startDate: new Date('2026-01-01'),
      expectedCompletionDate: new Date('2026-12-31'),
      status: 'ACTIVE',
      budgetEstimate: 500000,
      createdById: admin.id,
      engineers: { create: [{ engineerId: engineer1.id }] },
    },
  });

  const project2 = await prisma.project.create({
    data: {
      name: 'Lakeside Villas',
      gpsLat: 34.0522,
      gpsLng: -118.2437,
      address: '456 Lakeside Ave, Los Angeles, CA',
      clientId: client2.id,
      startDate: new Date('2026-02-01'),
      expectedCompletionDate: new Date('2026-11-30'),
      status: 'PLANNING',
      budgetEstimate: 750000,
      createdById: admin.id,
      engineers: { create: [{ engineerId: engineer2.id }] },
    },
  });

  const users = { admin, engineer1, engineer2, client1, client2 };

  console.log('\n=== Seed complete ===\n');

  console.log('User IDs:');
  for (const [key, user] of Object.entries(users)) {
    console.log(`  ${key}: ${user.id} (${user.email})`);
  }

  console.log('\nProject IDs:');
  console.log(`  project1 (Riverside Tower, client1, engineer1): ${project1.id}`);
  console.log(`  project2 (Lakeside Villas, client2, engineer2): ${project2.id}`);

  console.log('\nSample JWT access tokens (24h expiry, payload: userId + role):');
  for (const [key, user] of Object.entries(users)) {
    console.log(`  ${key}: ${issueToken(user)}`);
  }

  console.log('\nAll seeded users share the password: password123\n');
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
