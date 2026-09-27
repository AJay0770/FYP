/**
 * Adds realistic demo data to the projects that already exist, so every
 * feature has something to show: site updates, materials (with one deliberate
 * discrepancy), workers, two weeks of attendance, safety violations, project
 * chat, and a second laptop-webcam camera per project for practising moving
 * the webcam between feeds.
 *
 *   npm run seed:demo
 *
 * Safe on a database you care about, unlike seed-comprehensive.js:
 *  - it only ADDS rows - nothing is deleted or modified;
 *  - every demo row has a deterministic id, so re-running creates no
 *    duplicates and never overwrites a demo row you have since edited;
 *  - workers get no face embedding (that is real biometric data - enrol real
 *    faces through the app).
 */
require('dotenv').config();
const crypto = require('crypto');
const prisma = require('../src/utils/prisma');

// Deterministic UUID-shaped id from the demo row's identity.
function demoId(...parts) {
  const h = crypto.createHash('sha1').update(`buildsite-demo:${parts.join(':')}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

// Deterministic 0..1 value, so attendance/alert patterns are stable across runs.
function rand(...parts) {
  const h = crypto.createHash('sha1').update(parts.join(':')).digest();
  return h.readUInt32BE(0) / 0xffffffff;
}

const DAY_MS = 24 * 60 * 60 * 1000;
function daysAgo(days, hour = 10, minute = 0) {
  const d = new Date(Date.now() - days * DAY_MS);
  d.setHours(hour, minute, 0, 0);
  return d;
}
// AttendanceRecord.date is a @db.Date: midnight UTC of that calendar day.
function dateOnly(d) {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

let created = 0;
let existing = 0;
// Create-only upsert: an existing row (same demo id) is left exactly as it is.
async function add(model, id, data) {
  const found = await prisma[model].findUnique({ where: { id }, select: { id: true } });
  if (found) {
    existing++;
    return;
  }
  await prisma[model].create({ data: { id, ...data } });
  created++;
}

// ---------------------------------------------------------------------------
// Content. Keyed by a "theme" so each project reads differently; a project
// with no dedicated theme gets the construction theme.
// ---------------------------------------------------------------------------

const THEMES = {
  construction: {
    extraCamera: { name: 'Main Gate', zone: 'ENTRANCE' },
    workers: ['Ahmed Raza', 'Bilal Khan', 'Usman Tariq', 'Hamza Ali', 'Faisal Mehmood', 'Imran Shah'],
    siteUpdates: [
      [20, 'Excavation for the tower foundation completed. Soil compaction test results are within specification.', 'IMAGE'],
      [16, 'Raft foundation poured (320 m³). Curing in progress; formwork removal scheduled after 7 days.', 'MIXED'],
      [12, 'Ground floor columns cast. Rebar inspection passed with minor spacing corrections on grid C.', 'IMAGE'],
      [8, 'First floor slab formwork erected and inspected. Scaffolding on the west side extended to level 2.', 'IMAGE'],
      [4, 'First floor slab poured. Two PPE violations flagged by the west camera; toolbox talk held with the crew.', 'MIXED'],
      [1, 'Second floor column rebar in progress. Brick stock recount requested - consumption logged above deliveries.', 'IMAGE'],
    ],
    // [name, category, type, quantity, unitCost (PKR), daysAgo]
    materials: [
      ['Portland Cement (bags)', 'Cement', 'RECEIVED', 600, 1350, 21],
      ['Portland Cement (bags)', 'Cement', 'CONSUMED', 320, 1350, 16],
      ['Portland Cement (bags)', 'Cement', 'CONSUMED', 180, 1350, 4],
      ['Steel Rebar 16mm (tons)', 'Steel', 'RECEIVED', 18, 245000, 19],
      ['Steel Rebar 16mm (tons)', 'Steel', 'CONSUMED', 11.5, 245000, 12],
      ['Bricks', 'Masonry', 'RECEIVED', 20000, 18, 10],
      // Deliberate discrepancy: more consumed than received.
      ['Bricks', 'Masonry', 'CONSUMED', 23500, 18, 2],
      ['River Sand (m³)', 'Aggregates', 'RECEIVED', 80, 4200, 20],
      ['River Sand (m³)', 'Aggregates', 'CONSUMED', 52, 4200, 8],
      ['Crushed Stone (m³)', 'Aggregates', 'RECEIVED', 60, 5100, 18],
      ['Crushed Stone (m³)', 'Aggregates', 'CONSUMED', 41, 5100, 6],
    ],
    // [sender role, daysAgo, hour, minute, text]
    chat: [
      ['client', 6, 9, 5, 'Good morning. Any update on the first floor slab pour?'],
      ['engineer', 6, 9, 22, 'Morning! Formwork and rebar were inspected yesterday. The pour is scheduled for Thursday at 7 AM, weather permitting.'],
      ['admin', 6, 10, 2, 'Please make sure the concrete supplier confirms the order by tomorrow.'],
      ['engineer', 5, 16, 40, 'Confirmed with the supplier - two trucks booked, first arrival 6:45 AM.'],
      ['client', 4, 11, 15, 'Great. Would the site be open for a visit on Saturday?'],
      ['admin', 4, 11, 48, 'Yes, 11 AM works. Visitors must wear helmets and vests - spare PPE will be at the main gate.'],
      ['engineer', 4, 14, 30, 'Heads-up: the west camera flagged two helmet violations this morning. I have spoken to the crew and held a toolbox talk.'],
      ['client', 4, 15, 3, 'Thanks for flagging that. Safety first.'],
      ['engineer', 1, 17, 10, 'Brick consumption is logged above what we received - recounting the stock today, it may be a logging error.'],
      ['admin', 1, 17, 35, 'Please update the materials log once the recount is done and note the reason.'],
      ['client', 0, 8, 50, 'Could you share this week\'s progress report when it is ready?'],
      ['admin', 0, 9, 12, 'Sure - you can generate it from Reports on the project page, or I will send the weekly one on Monday.'],
    ],
  },
  planning: {
    extraCamera: { name: 'Storage Yard', zone: 'STORAGE' },
    workers: ['Zain Abbas', 'Ali Hassan', 'Kashif Iqbal', 'Waqas Ahmed', 'Naveed Akhtar', 'Saad Qureshi'],
    siteUpdates: [
      [18, 'Topographic survey of the plot completed. Boundary markers installed at all corners.', 'IMAGE'],
      [13, 'Soil investigation boreholes drilled (6 locations). Samples sent to the lab.', 'IMAGE'],
      [9, 'Soil report received: bearing capacity suitable for strip foundations across villas 1-8.', 'MIXED'],
      [5, 'Site clearing started - vegetation removal and debris hauling on the north side.', 'IMAGE'],
      [2, 'Temporary site office and storage yard fencing completed. Security camera installed on the north side.', 'MIXED'],
    ],
    materials: [
      ['Portland Cement (bags)', 'Cement', 'RECEIVED', 200, 1350, 6],
      ['Portland Cement (bags)', 'Cement', 'CONSUMED', 35, 1350, 3],
      ['Steel Rebar 12mm (tons)', 'Steel', 'RECEIVED', 6, 238000, 5],
      ['Fencing Panels', 'Site Setup', 'RECEIVED', 120, 3200, 8],
      ['Fencing Panels', 'Site Setup', 'CONSUMED', 112, 3200, 3],
      ['Gravel (m³)', 'Aggregates', 'RECEIVED', 25, 4800, 7],
      ['Gravel (m³)', 'Aggregates', 'CONSUMED', 18, 4800, 2],
    ],
    chat: [
      ['client', 7, 10, 0, 'Have the revised villa layouts been approved by the authority yet?'],
      ['engineer', 7, 10, 25, 'The revised drawings were submitted on Monday. Approval is expected within two weeks.'],
      ['admin', 7, 11, 5, 'Once approved we start site clearing. Please prepare the mobilisation plan in the meantime.'],
      ['engineer', 6, 15, 20, 'Will do. The soil investigation report is back - bearing capacity is fine for strip foundations.'],
      ['client', 5, 9, 40, 'Good news. What is the expected start date for excavation?'],
      ['engineer', 5, 10, 5, 'Tentatively the 15th of next month, subject to the approval.'],
      ['admin', 2, 12, 30, 'The north side camera is installed and online for site security.'],
      ['client', 2, 13, 2, 'Can I see the camera feed from my account?'],
      ['admin', 2, 13, 20, 'Yes - open the project and scroll to Live monitoring.'],
      ['engineer', 1, 16, 45, 'First delivery of cement and steel went to the storage yard today. Materials log is updated.'],
    ],
  },
};

function themeFor(project) {
  return project.status === 'PLANNING' ? THEMES.planning : THEMES.construction;
}

async function seedProject(project, admin) {
  const theme = themeFor(project);
  const engineer = project.engineers[0]?.engineer || admin;
  const people = { admin, engineer, client: project.client };
  const key = (...parts) => demoId(project.id, ...parts);

  // A second laptop-webcam camera, to practise moving the webcam between feeds.
  await add('camera', key('camera', 'extra'), {
    projectId: project.id,
    name: theme.extraCamera.name,
    zone: theme.extraCamera.zone,
    rtspUrl: '0',
  });
  const cameras = await prisma.camera.findMany({ where: { projectId: project.id }, orderBy: { createdAt: 'asc' } });

  for (const [i, [days, description, mediaType]] of theme.siteUpdates.entries()) {
    await add('siteUpdate', key('update', i), {
      projectId: project.id,
      engineerId: engineer.id,
      description,
      mediaType,
      createdAt: daysAgo(days, 17, 15),
    });
  }

  for (const [i, [name, category, entryType, quantity, unitCost, days]] of theme.materials.entries()) {
    await add('materialEntry', key('material', i), {
      projectId: project.id,
      name,
      category,
      entryType,
      quantity,
      unitCost,
      date: daysAgo(days, 9),
      loggedById: engineer.id,
      createdAt: daysAgo(days, 9, 30),
    });
  }

  const prefix = project.name.split(/\s+/).map((w) => w[0]).join('').toUpperCase();
  const workers = [];
  for (const [i, name] of theme.workers.entries()) {
    const id = key('worker', i);
    await add('worker', id, {
      projectId: project.id,
      name,
      employeeId: `${prefix}-${101 + i}`,
      enrolledAt: daysAgo(21, 8),
    });
    workers.push(id);
  }

  // Two weeks of check-ins, ~80% attendance, no Sundays.
  for (let days = 13; days >= 0; days--) {
    const day = daysAgo(days, 8);
    if (day.getDay() === 0) continue;
    for (const workerId of workers) {
      if (rand(workerId, days) < 0.2) continue;
      const minute = Math.floor(rand(workerId, days, 'm') * 70); // 7:30 - 8:40
      await add('attendanceRecord', key('attendance', workerId, dateOnly(day).toISOString().slice(0, 10)), {
        workerId,
        projectId: project.id,
        checkInTime: daysAgo(days, 7, 30 + minute),
        matchConfidence: (0.82 + rand(workerId, days, 'c') * 0.15).toFixed(4),
        date: dateOnly(day),
      });
    }
  }

  // Safety violations spread over the fortnight, attributed to demo workers.
  if (cameras.length) {
    const alertDays = [12, 11, 9, 7, 6, 4, 4, 2, 1, 0];
    for (const [i, days] of alertDays.entries()) {
      await add('safetyAlert', key('alert', i), {
        projectId: project.id,
        cameraId: cameras[i % cameras.length].id,
        workerId: workers[Math.floor(rand(project.id, 'alert', i) * workers.length)],
        violationType: rand(project.id, 'type', i) < 0.65 ? 'NO_HELMET' : 'NO_VEST',
        confidenceScore: (0.62 + rand(project.id, 'conf', i) * 0.33).toFixed(4),
        frameImageUrl: '',
        createdAt: daysAgo(days, 9 + (i % 7), (i * 13) % 60),
      });
    }
  }

  for (const [i, [role, days, hour, minute, content]] of theme.chat.entries()) {
    await add('chatMessage', key('chat', i), {
      projectId: project.id,
      senderId: people[role].id,
      content,
      createdAt: daysAgo(days, hour, minute),
    });
  }
}

async function main() {
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, orderBy: { createdAt: 'asc' } });
  if (!admin) throw new Error('No ADMIN user exists - create one (register) before seeding demo data.');

  const projects = await prisma.project.findMany({
    include: { client: true, engineers: { include: { engineer: true } } },
    orderBy: { createdAt: 'asc' },
  });
  if (!projects.length) throw new Error('No projects exist - create a project first; demo data is added to existing projects.');

  for (const project of projects) {
    const before = created;
    await seedProject(project, admin);
    console.log(`  ${project.name}: ${created - before} demo row(s) added`);
  }
  console.log(`\nDone: ${created} added, ${existing} already present (left unchanged). Nothing was deleted.`);
}

main()
  .catch((err) => {
    console.error('Demo seed failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
