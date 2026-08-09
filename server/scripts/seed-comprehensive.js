/**
 * Comprehensive, reproducible test data covering every read path in the app.
 *
 * Deterministic by design: fixed UUIDs and a fixed clock offset, so Postman
 * collections and the manual test script can reference IDs directly without
 * re-reading them from the console each run.
 *
 *   npm run seed:full
 */
require('dotenv').config();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const prisma = require('../src/utils/prisma');

// Fixed IDs so tests can hardcode them.
const ID = {
  admin: '00000000-0000-4000-8000-000000000001',
  engineer1: '00000000-0000-4000-8000-000000000002',
  engineer2: '00000000-0000-4000-8000-000000000003',
  client1: '00000000-0000-4000-8000-000000000004',
  client2: '00000000-0000-4000-8000-000000000005',
  project1: '00000000-0000-4000-8000-000000000101',
  project2: '00000000-0000-4000-8000-000000000102',
  cameraEntrance: '00000000-0000-4000-8000-000000000201',
  cameraWorkArea: '00000000-0000-4000-8000-000000000202',
  worker1: '00000000-0000-4000-8000-000000000301',
  subscription: '00000000-0000-4000-8000-000000000401',
};

const PASSWORD = 'password123';

function minutesAgo(minutes) {
  return new Date(Date.now() - minutes * 60 * 1000);
}

function utcDay(offsetDays = 0) {
  const now = new Date();
  const day = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  day.setUTCDate(day.getUTCDate() + offsetDays);
  return day;
}

async function clearAll() {
  // Children before parents, to respect FK constraints.
  await prisma.report.deleteMany();
  await prisma.safetyAlert.deleteMany();
  await prisma.attendanceRecord.deleteMany();
  await prisma.worker.deleteMany();
  await prisma.camera.deleteMany();
  await prisma.chatMessage.deleteMany();
  await prisma.materialEntry.deleteMany();
  await prisma.siteUpdate.deleteMany();
  await prisma.projectEngineer.deleteMany();
  await prisma.subscription.deleteMany();
  await prisma.project.deleteMany();
  await prisma.user.deleteMany();
}

async function main() {
  console.log('Clearing existing data...');
  await clearAll();

  const passwordHash = await bcrypt.hash(PASSWORD, 12);

  console.log('Creating users...');
  await prisma.user.createMany({
    data: [
      { id: ID.admin, name: 'Admin User', email: 'admin@test.com', passwordHash, role: 'ADMIN' },
      { id: ID.engineer1, name: 'Engineer One', email: 'engineer1@test.com', passwordHash, role: 'ENGINEER' },
      { id: ID.engineer2, name: 'Engineer Two', email: 'engineer2@test.com', passwordHash, role: 'ENGINEER' },
      { id: ID.client1, name: 'Client One', email: 'client1@test.com', passwordHash, role: 'CLIENT' },
      { id: ID.client2, name: 'Client Two', email: 'client2@test.com', passwordHash, role: 'CLIENT' },
    ],
  });

  console.log('Creating projects...');
  await prisma.project.create({
    data: {
      id: ID.project1,
      name: 'Riverside Tower',
      gpsLat: 40.7128,
      gpsLng: -74.006,
      address: '123 Riverside Dr, New York, NY',
      clientId: ID.client1,
      startDate: new Date('2026-01-01'),
      expectedCompletionDate: new Date('2026-12-31'),
      status: 'ACTIVE',
      budgetEstimate: 500000,
      createdById: ID.admin,
      engineers: { create: [{ engineerId: ID.engineer1 }] },
    },
  });

  await prisma.project.create({
    data: {
      id: ID.project2,
      name: 'Lakeside Villas',
      gpsLat: 34.0522,
      gpsLng: -118.2437,
      address: '456 Lakeside Ave, Los Angeles, CA',
      clientId: ID.client2,
      startDate: new Date('2026-02-01'),
      expectedCompletionDate: new Date('2026-11-30'),
      status: 'PLANNING',
      budgetEstimate: 750000,
      createdById: ID.admin,
      engineers: { create: [{ engineerId: ID.engineer2 }] },
    },
  });

  console.log('Creating site updates...');
  // Explicit, distinct createdAt values. createMany() would stamp every row with
  // the same timestamp, which makes "newest first" ordering non-deterministic —
  // the API could be sorting correctly or not at all and the data could not tell
  // you which. Staggering them makes the ordering assertions meaningful.
  await prisma.siteUpdate.createMany({
    data: [
      {
        projectId: ID.project1,
        engineerId: ID.engineer1,
        description: 'Foundation slab poured, curing started',
        mediaUrls: [
          'http://localhost:9000/buildsite-dev/sample-foundation-1.jpg',
          'http://localhost:9000/buildsite-dev/sample-foundation-2.jpg',
        ],
        mediaType: 'IMAGE',
        createdAt: minutesAgo(180), // oldest
      },
      {
        projectId: ID.project1,
        engineerId: ID.engineer1,
        description: 'Steel framing delivered and staged',
        mediaUrls: ['http://localhost:9000/buildsite-dev/sample-framing.mp4'],
        mediaType: 'VIDEO',
        createdAt: minutesAgo(60), // newest — must appear first in the UI
      },
      {
        projectId: ID.project2,
        engineerId: ID.engineer2,
        description: 'Site survey complete, excavation scheduled',
        mediaUrls: [],
        mediaType: 'IMAGE',
        createdAt: minutesAgo(120),
      },
    ],
  });

  console.log('Creating material entries (with an intentional discrepancy)...');
  await prisma.materialEntry.createMany({
    data: [
      // Cement: healthy — more received than consumed.
      { projectId: ID.project1, name: 'Cement', category: 'Binder', entryType: 'RECEIVED', quantity: 500, unitCost: 8.5, date: utcDay(-10), loggedById: ID.engineer1 },
      { projectId: ID.project1, name: 'Cement', category: 'Binder', entryType: 'CONSUMED', quantity: 180, unitCost: 8.5, date: utcDay(-5), loggedById: ID.engineer1 },
      // Steel Rebar: healthy.
      { projectId: ID.project1, name: 'Steel Rebar', category: 'Structural', entryType: 'RECEIVED', quantity: 1200, unitCost: 1.2, date: utcDay(-8), loggedById: ID.engineer1 },
      { projectId: ID.project1, name: 'Steel Rebar', category: 'Structural', entryType: 'CONSUMED', quantity: 900, unitCost: 1.2, date: utcDay(-3), loggedById: ID.engineer1 },
      // Bricks: INTENTIONAL DISCREPANCY — 800 consumed, only 500 ever received.
      { projectId: ID.project1, name: 'Bricks', category: 'Masonry', entryType: 'RECEIVED', quantity: 500, unitCost: 0.5, date: utcDay(-7), loggedById: ID.engineer1 },
      { projectId: ID.project1, name: 'Bricks', category: 'Masonry', entryType: 'CONSUMED', quantity: 800, unitCost: 0.5, date: utcDay(-2), loggedById: ID.engineer1 },
      // Project 2 material.
      { projectId: ID.project2, name: 'Gravel', category: 'Aggregate', entryType: 'RECEIVED', quantity: 300, unitCost: 2.0, date: utcDay(-4), loggedById: ID.engineer2 },
    ],
  });

  console.log('Creating cameras...');
  await prisma.camera.createMany({
    data: [
      {
        id: ID.cameraEntrance,
        projectId: ID.project1,
        name: 'Main Gate',
        zone: 'ENTRANCE',
        rtspUrl: 'rtsp://127.0.0.1:8554/testcam',
        status: 'OFFLINE',
      },
      {
        id: ID.cameraWorkArea,
        projectId: ID.project1,
        name: 'Work Area North',
        zone: 'WORK_AREA',
        rtspUrl: 'rtsp://127.0.0.1:8554/testcam',
        status: 'OFFLINE',
      },
    ],
  });

  console.log('Creating safety alerts...');
  await prisma.safetyAlert.createMany({
    data: [
      { projectId: ID.project1, cameraId: ID.cameraWorkArea, violationType: 'NO_HELMET', confidenceScore: 0.91, frameImageUrl: 'http://localhost:9000/buildsite-dev/sample-alert-1.jpg', createdAt: minutesAgo(200) },
      { projectId: ID.project1, cameraId: ID.cameraWorkArea, violationType: 'NO_VEST', confidenceScore: 0.78, frameImageUrl: 'http://localhost:9000/buildsite-dev/sample-alert-2.jpg', createdAt: minutesAgo(100) },
      // Newest — must appear at the top of the alerts table.
      { projectId: ID.project1, cameraId: ID.cameraEntrance, violationType: 'NO_HELMET', confidenceScore: 0.83, frameImageUrl: 'http://localhost:9000/buildsite-dev/sample-alert-3.jpg', createdAt: minutesAgo(20) },
    ],
  });

  console.log('Creating chat messages...');
  // Distinct timestamps for the same reason as site updates — chat history is
  // specified as chronological, and identical timestamps make that unverifiable.
  await prisma.chatMessage.createMany({
    data: [
      { projectId: ID.project1, senderId: ID.admin, content: 'Morning standup at 8am on site.', createdAt: minutesAgo(90) },
      { projectId: ID.project1, senderId: ID.engineer1, content: 'Understood. Slab curing is on schedule.', createdAt: minutesAgo(45) },
      { projectId: ID.project1, senderId: ID.client1, content: 'Thanks for the update, looks good.', createdAt: minutesAgo(10) },
    ],
  });

  console.log('Creating worker + attendance...');
  // A placeholder embedding: 512 dims, deterministic, unit-normalised. NOT derived
  // from a real face — it only exists so read paths and the shape of the data can
  // be exercised without real biometric data.
  const raw = Array.from({ length: 512 }, (_, i) => Math.sin(i + 1));
  const norm = Math.sqrt(raw.reduce((s, v) => s + v * v, 0));
  const placeholderEmbedding = raw.map((v) => v / norm);

  await prisma.worker.create({
    data: {
      id: ID.worker1,
      projectId: ID.project1,
      name: 'Ali Hassan',
      employeeId: 'EMP-001',
      faceEmbedding: JSON.stringify(placeholderEmbedding),
    },
  });

  // Several days of attendance so weekly/monthly aggregates differ from daily.
  await prisma.attendanceRecord.createMany({
    data: [
      { workerId: ID.worker1, projectId: ID.project1, matchConfidence: 0.88, date: utcDay(0), checkInTime: new Date() },
      { workerId: ID.worker1, projectId: ID.project1, matchConfidence: 0.85, date: utcDay(-1), checkInTime: new Date(Date.now() - 86400000) },
      { workerId: ID.worker1, projectId: ID.project1, matchConfidence: 0.9, date: utcDay(-2), checkInTime: new Date(Date.now() - 2 * 86400000) },
    ],
  });

  console.log('Creating subscription...');
  await prisma.subscription.create({
    data: {
      id: ID.subscription,
      companyAdminId: ID.admin,
      plan: 'PRO',
      status: 'ACTIVE',
      provider: 'EASYPAISA',
      providerReference: 'BS360-SEED-REFERENCE',
      startDate: utcDay(-30),
      nextBillingDate: utcDay(30),
    },
  });

  // ---- Output -------------------------------------------------------------
  const token = (id, role) =>
    jwt.sign({ userId: id, role }, process.env.JWT_SECRET, { expiresIn: '24h' });

  const tokens = {
    adminToken: token(ID.admin, 'ADMIN'),
    engineer1Token: token(ID.engineer1, 'ENGINEER'),
    engineer2Token: token(ID.engineer2, 'ENGINEER'),
    client1Token: token(ID.client1, 'CLIENT'),
    client2Token: token(ID.client2, 'CLIENT'),
    expiredToken: jwt.sign({ userId: ID.admin, role: 'ADMIN' }, process.env.JWT_SECRET, { expiresIn: '-1h' }),
  };

  console.log('\n=== Seed complete ===\n');
  console.log('All users share password:', PASSWORD);
  console.log('\nFixed IDs:');
  Object.entries(ID).forEach(([k, v]) => console.log(`  ${k.padEnd(16)} ${v}`));
  console.log('\nData created:');
  console.log('  5 users, 2 projects, 3 site updates, 7 material entries (Bricks has a discrepancy)');
  console.log('  2 cameras (ENTRANCE + WORK_AREA), 3 safety alerts, 3 chat messages');
  console.log('  1 worker with 3 days attendance, 1 ACTIVE PRO subscription');

  const fs = require('fs');
  const path = require('path');
  const outPath = path.join(__dirname, '..', 'tests', 'seed-output.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        ids: ID,
        tokens,
        internalToken: process.env.X_INTERNAL_TOKEN,
        baseUrl: `http://localhost:${process.env.PORT || 3000}/api`,
        generatedAt: new Date().toISOString(),
      },
      null,
      2
    )
  );
  console.log(`\nIDs and tokens written to ${outPath}`);
  console.log('(Import that file as a Postman environment, or read it from test scripts.)\n');
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
