// functions/lib/prescriptionPdf.js
//
// The official prescription form (A4 PDF), built on the server so the
// doctor's signature image never reaches a browser and the form can't be
// altered before download (prescriptions.js getPrescriptionPdf).
//
// Header: hospital logo, name, address and phone (as in the website footer,
// components/shared/footer.jsx: keep the two in step). Then the reference
// and dates, the patient, the medicines, the doctor's signature, name and
// MDC number, and a QR code that opens the public check page
// (/check-prescription#<code>), where a pharmacist sees whether it's valid.

const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");
const QRCode = require("qrcode");
const { SITE_URL } = require("./mailConfig");
const { VALID_DAYS } = require("./prescriptions");

const HOSPITAL = {
  name: "Holy Family Catholic Hospital, Berekum",
  address: "P.O. Box 21, Berekum, Brong Ahafo, Ghana",
  phone: "Tel: 035 222 2034  |  035 202 2433  |  +233 50 115 6668",
  email: "info@hfhberekum.org",
};

const LOGO = fs.readFileSync(path.join(__dirname, "..", "assets", "hospital-logo.png"));

const INK = "#12242C";
const MUTED = "#5C6B72";
const LINE = "#C9D6DE";
const BRAND = "#0B6BA0";

const TZ = "Africa/Accra";

function formatDate(d) {
  return new Date(d).toLocaleDateString("en-GB", { timeZone: TZ, day: "numeric", month: "long", year: "numeric" });
}
function formatDateTime(d) {
  const date = formatDate(d);
  const time = new Date(d).toLocaleTimeString("en-GB", { timeZone: TZ, hour: "numeric", minute: "2-digit", hour12: true });
  return `${date}, ${time}`;
}

// The PDF's built-in fonts (Helvetica) only draw Western European
// characters (WinAnsi). Letters such as Ɛ, Ɔ and Ŋ in Ghanaian names are
// written as their nearest plain letter; anything else unprintable as "?".
const FOLD = new Map(Object.entries({ "Ɛ": "E", "ɛ": "e", "Ɔ": "O", "ɔ": "o", "Ŋ": "N", "ŋ": "n", "Ʋ": "V", "ʋ": "v", "Ɣ": "G", "ɣ": "g" }));
const WINANSI_EXTRA = new Set([..."€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ"]);
function pdfSafe(text) {
  if (text === null || text === undefined) return "";
  return [...String(text)]
    .map((ch) => {
      const code = ch.codePointAt(0);
      if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WINANSI_EXTRA.has(ch)) return ch;
      if (FOLD.has(ch)) return FOLD.get(ch);
      const base = ch.normalize("NFKD").replace(/[̀-ͯ]/g, "");
      return base && [...base].every((c) => c.codePointAt(0) >= 0x20 && c.codePointAt(0) <= 0x7e) ? base : "?";
    })
    .join("");
}

/** URL the QR code opens. The code is in the #fragment, so it never reaches a server log. */
function checkUrl(code) {
  return `${SITE_URL}/check-prescription#${code}`;
}

function drawQr(doc, text, x, y, size) {
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const n = qr.modules.size;
  const cell = size / n;
  doc.save().fillColor("#000000");
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.modules.get(r, c)) doc.rect(x + c * cell, y + r * cell, cell, cell);
    }
  }
  doc.fill().restore();
}

/**
 * rx: the prescriptions/{id} document (Dates for issuedAt / expiresAt).
 * signaturePng: base64 PNG of the doctor's signature (or null).
 * Resolves a Buffer.
 */
function buildPrescriptionPdf(rx, signaturePng) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 40, bottom: 40, left: 50, right: 50 },
      info: {
        Title: `Prescription ${rx.id}`,
        Author: HOSPITAL.name,
        Subject: "Prescription",
        Creator: "Holy Family telemedicine",
      },
    });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    const width = right - left;

    // ---- header ----
    doc.image(LOGO, left, 40, { width: 64, height: 64 });
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(17)
      .text(HOSPITAL.name.toUpperCase(), left + 78, 46, { width: width - 78 });
    doc.font("Helvetica").fontSize(9.5).fillColor(MUTED)
      .text(HOSPITAL.address, left + 78, doc.y + 2, { width: width - 78 })
      .text(`${HOSPITAL.phone}  |  ${HOSPITAL.email}`, { width: width - 78 });
    let y = 116;
    doc.moveTo(left, y).lineTo(right, y).lineWidth(2).strokeColor(BRAND).stroke();

    // ---- title ----
    y += 12;
    doc.fillColor(BRAND).font("Helvetica-Bold").fontSize(15).text("PRESCRIPTION", left, y);
    doc.fillColor(MUTED).font("Helvetica").fontSize(9.5)
      .text("Telemedicine (video) consultation", left, y + 3, { width, align: "right" });
    y += 26;

    // ---- reference and dates ----
    const col = width / 3;
    const field = (label, value, x, fy, w) => {
      doc.fillColor(MUTED).font("Helvetica").fontSize(8.5).text(label.toUpperCase(), x, fy, { width: w });
      doc.fillColor(INK).font("Helvetica-Bold").fontSize(11).text(pdfSafe(value || "-"), x, fy + 11, { width: w });
    };
    field("Reference", rx.id, left, y, col);
    field("Date issued", formatDateTime(rx.issuedAt), left + col, y, col);
    field("Valid until", formatDate(rx.expiresAt), left + 2 * col, y, col);
    y += 36;

    // ---- patient ----
    doc.roundedRect(left, y, width, rx.guardianName ? 58 : 44, 4).lineWidth(0.8).strokeColor(LINE).stroke();
    const py = y + 9;
    field("Patient", rx.patientName, left + 10, py, width * 0.5 - 10);
    field("Age", rx.patientAge, left + width * 0.5, py, width * 0.25);
    field("Sex", rx.patientSex ? rx.patientSex[0].toUpperCase() + rx.patientSex.slice(1) : null, left + width * 0.75, py, width * 0.25 - 10);
    if (rx.guardianName) {
      doc.fillColor(MUTED).font("Helvetica").fontSize(9)
        .text(`Parent/guardian: ${pdfSafe(rx.guardianName)}`, left + 10, py + 30, { width: width - 20 });
    }
    y += (rx.guardianName ? 58 : 44) + 16;

    // ---- medicines ----
    doc.fillColor(BRAND).font("Times-BoldItalic").fontSize(26).text("Rx", left, y);
    y += 34;
    const cols = [
      { key: "n", label: "#", w: 20 },
      { key: "medicine", label: "Medicine", w: 165 },
      { key: "dose", label: "Dose", w: 80 },
      { key: "frequency", label: "How often", w: 85 },
      { key: "duration", label: "How long", w: 70 },
      { key: "quantity", label: "Quantity", w: width - 420 },
    ];
    const drawRow = (cells, ry, { bold = false, color = INK } = {}) => {
      let x = left;
      let h = 0;
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(bold ? 8.5 : 10).fillColor(color);
      for (const c of cols) {
        const t = pdfSafe(cells[c.key] ?? "");
        h = Math.max(h, doc.heightOfString(t, { width: c.w - 6 }));
        doc.text(t, x + 3, ry, { width: c.w - 6 });
        x += c.w;
      }
      return h;
    };
    const headH = drawRow(
      Object.fromEntries(cols.map((c) => [c.key, c.label.toUpperCase()])),
      y,
      { bold: true, color: MUTED },
    );
    y += headH + 4;
    doc.moveTo(left, y).lineTo(right, y).lineWidth(0.8).strokeColor(LINE).stroke();
    y += 6;
    rx.items.forEach((item, i) => {
      const medicine = [item.medicine, item.strength, item.form].filter(Boolean).join(" ");
      const h = drawRow({ ...item, n: `${i + 1}.`, medicine }, y);
      y += h + 6;
      doc.moveTo(left, y).lineTo(right, y).lineWidth(0.4).strokeColor(LINE).stroke();
      y += 6;
    });

    if (rx.notes) {
      y += 4;
      doc.fillColor(MUTED).font("Helvetica-Bold").fontSize(8.5).text("NOTES", left, y);
      doc.fillColor(INK).font("Helvetica").fontSize(10).text(pdfSafe(rx.notes), left, y + 12, { width });
      y = doc.y + 6;
    }

    // ---- prescriber and QR (kept together at the foot of the page) ----
    const footY = () => doc.page.height - 40 - 26;
    let blockTop = Math.max(y + 20, footY() - 170);
    if (blockTop + 160 > footY()) {
      // A long list: the signature and QR go on a second page.
      doc.addPage();
      blockTop = 60;
    }
    const qrSize = 104;
    const sigW = 190;
    if (signaturePng) {
      try {
        doc.image(Buffer.from(signaturePng, "base64"), left, blockTop, { fit: [sigW, 60], valign: "bottom" });
      } catch {
        // A signature that can't be drawn leaves the line empty; never fail the form.
      }
    }
    const lineY = blockTop + 64;
    doc.moveTo(left, lineY).lineTo(left + sigW + 40, lineY).lineWidth(0.8).strokeColor(INK).stroke();
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(11).text(pdfSafe(rx.doctorName), left, lineY + 6, { width: sigW + 40 });
    doc.font("Helvetica").fontSize(9.5).fillColor(MUTED);
    if (rx.doctorDepartment) doc.text(pdfSafe(rx.doctorDepartment), { width: sigW + 40 });
    doc.text(`MDC Reg. No.: ${pdfSafe(rx.doctorMdcNumber)}`, { width: sigW + 40 });
    doc.text(`Signed electronically, ${formatDateTime(rx.issuedAt)}`, { width: sigW + 40 });

    const qrX = right - qrSize;
    drawQr(doc, checkUrl(rx.checkCode), qrX, blockTop, qrSize);
    doc.fillColor(MUTED).font("Helvetica").fontSize(8)
      .text("Pharmacist: scan to check this prescription", qrX - 130, blockTop + qrSize + 4, { width: qrSize + 130, align: "right" })
      .text(`or enter code ${rx.checkCode.replace(/(.{5})(?=.)/g, "$1-")}`, { width: qrSize + 130, align: "right" })
      .text(`at ${SITE_URL.replace(/^https?:\/\//, "")}/check-prescription`, { width: qrSize + 130, align: "right" });

    // ---- footer ----
    doc.moveTo(left, footY() - 6).lineTo(right, footY() - 6).lineWidth(0.4).strokeColor(LINE).stroke();
    doc.fillColor(MUTED).font("Helvetica").fontSize(8)
      .text(
        `Valid for ${VALID_DAYS} days from the date of issue. Dispense only if the check above shows it as valid. ` +
          "Issued through the Holy Family Catholic Hospital telemedicine service.",
        left,
        footY(),
        { width, align: "center", lineBreak: true },
      );

    doc.end();
  });
}

module.exports = { buildPrescriptionPdf, checkUrl, pdfSafe };
