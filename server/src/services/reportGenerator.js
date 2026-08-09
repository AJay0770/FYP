const PDFDocument = require('pdfkit');
const prisma = require('../utils/prisma');
const { getProjectSummary } = require('./reportingService');
const { uploadBuffer } = require('../utils/s3');

function renderPdf(summary, reportType) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const from = new Date(summary.range.from).toISOString().slice(0, 10);
    const to = new Date(summary.range.to).toISOString().slice(0, 10);

    const heading = (text) => doc.moveDown(0.8).fontSize(14).text(text).moveDown(0.3).fontSize(10);
    const line = (text) => doc.fontSize(10).text(text);

    // --- Header ---
    doc.fontSize(20).text('BuildSite 360', { align: 'center' });
    doc.fontSize(12).text(`${reportType} Report`, { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(16).text(summary.project.name, { align: 'center' });
    doc.fontSize(10).text(`${from} to ${to}`, { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(9).text(`Status: ${summary.project.status}   |   ${summary.project.address}`, {
      align: 'center',
    });

    // --- Site updates ---
    heading('Site Updates');
    line(`Total updates logged: ${summary.siteUpdates.total}`);

    // --- Attendance ---
    heading('Attendance');
    line(`Total check-ins: ${summary.attendance.totalCheckins}`);
    line(`Unique workers: ${summary.attendance.uniqueWorkers}`);
    line(
      `Average match confidence: ${
        summary.attendance.avgMatchConfidence !== null
          ? summary.attendance.avgMatchConfidence.toFixed(4)
          : 'n/a'
      }`
    );

    // --- Safety ---
    heading('Safety Violations');
    line(`Total violations: ${summary.safety.totalViolations}`);
    if (summary.safety.byType.length === 0) {
      line('No violations recorded in this period.');
    } else {
      doc.moveDown(0.2);
      line('By type:');
      summary.safety.byType.forEach((v) => {
        const conf = v.avgConfidence !== null ? v.avgConfidence.toFixed(3) : 'n/a';
        line(`   ${v.violationType}: ${v.count} (avg confidence ${conf})`);
      });
      doc.moveDown(0.2);
      line('By camera:');
      summary.safety.byCamera.forEach((v) => {
        line(`   ${v.cameraName} [${v.zone ?? 'unknown zone'}]: ${v.count}`);
      });
    }

    // --- Materials ---
    heading('Materials');
    if (summary.materials.items.length === 0) {
      line('No material entries in this period.');
    } else {
      summary.materials.items.forEach((m) => {
        const flag = m.discrepancy ? '  ** DISCREPANCY **' : '';
        line(
          `   ${m.name}: received ${m.totalReceived}, consumed ${m.totalConsumed}, ` +
            `remaining ${m.difference}${flag}`
        );
      });
      doc.moveDown(0.3);
      line(`Items flagged with a discrepancy: ${summary.materials.discrepancyCount}`);
      if (summary.materials.discrepancyCount > 0) {
        line('A discrepancy means more of an item was consumed than was ever recorded as received.');
      }
    }

    doc.moveDown(1.5);
    doc.fontSize(8).text(`Generated ${new Date().toISOString()}`, { align: 'center' });

    doc.end();
  });
}

/**
 * Build the report, upload the PDF, and persist a Report row.
 * Returns the created Report record.
 */
async function generateReport(projectId, reportType, { startDate, endDate } = {}) {
  const summary = await getProjectSummary(projectId, { startDate, endDate });
  if (!summary) {
    throw Object.assign(new Error('Project not found'), { statusCode: 404 });
  }

  const pdfBuffer = await renderPdf(summary, reportType);

  const safeName = summary.project.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const { url } = await uploadBuffer(
    pdfBuffer,
    `${safeName}-${reportType.toLowerCase()}-report.pdf`,
    'application/pdf'
  );

  const report = await prisma.report.create({
    data: { projectId, reportType, pdfUrl: url },
  });

  return { report, summary, sizeBytes: pdfBuffer.length };
}

module.exports = { generateReport, renderPdf };
