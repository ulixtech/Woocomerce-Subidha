const ExcelJS = require('exceljs');
const fs = require('fs').promises;
const path = require('path');
const { sequelize } = require('../config/db');
const { QueryTypes } = require('sequelize');

/* ------------------------------------------------------------------------------------------------
   STATE CODE MAP & HELPERS
------------------------------------------------------------------------------------------------ */
const STATE_CODES = {
  'Jammu & Kashmir': '01', 'Himachal Pradesh': '02', 'Punjab': '03', 'Chandigarh': '04',
  'Uttarakhand': '05', 'Haryana': '06', 'Delhi': '07', 'Rajasthan': '08',
  'Uttar Pradesh': '09', 'Bihar': '10', 'Sikkim': '11', 'Arunachal Pradesh': '12',
  'Nagaland': '13', 'Manipur': '14', 'Mizoram': '15', 'Tripura': '16',
  'Meghalaya': '17', 'Assam': '18', 'West Bengal': '19', 'Jharkhand': '20',
  'Odisha': '21', 'Chhattisgarh': '22', 'Madhya Pradesh': '23', 'Gujarat': '24',
  'Daman & Diu': '25', 'Dadra & Nagar Haveli': '26', 'Maharashtra': '27',
  'Andhra Pradesh (Old)': '28', 'Karnataka': '29', 'Goa': '30', 'Lakshadweep': '31',
  'Kerala': '32', 'Tamil Nadu': '33', 'Puducherry': '34', 'Andaman & Nicobar Islands': '35',
  'Telangana': '36', 'Andhra Pradesh': '37', 'Ladakh': '38',
  'Others Territory': '97', 'Center Jurisdiction': '99'
};

const STATE_CODE_TO_NAME = Object.fromEntries(
  Object.entries(STATE_CODES).map(([name, code]) => [code, name])
);

/* Convert state_name to formatted POS like "19-West Bengal" */
function formatPlaceOfSupplyFromName(stateName) {
  if (!stateName) return "97-Other Territory";
  const nameClean = stateName.trim().toLowerCase();
  for (const [name, code] of Object.entries(STATE_CODES)) {
    if (name.toLowerCase() === nameClean) return `${code}-${name}`;
  }
  for (const [name, code] of Object.entries(STATE_CODES)) {
    if (name.toLowerCase().includes(nameClean) || nameClean.includes(name.toLowerCase())) {
      return `${code}-${name}`;
    }
  }
  return "97-Other Territory";
}

/* GST SPLIT */
function calculateGstSplit(totalTax, stateName) {
  const isIntrastate = (stateName || '').toLowerCase().includes('west bengal');
  totalTax = parseFloat(totalTax || 0);
  return {
    igst: isIntrastate ? 0 : totalTax,
    cgst: isIntrastate ? totalTax / 2 : 0,
    sgst: isIntrastate ? totalTax / 2 : 0
  };
}

/* HSN EXTRA DESCRIPTION MAP */
const HSN_DESCRIPTION_MAP = {
  "85238020": {
    description:
      "Broad Category: Discs, tapes, solid-state non-volatile storage devices, smart cards, and other media for recording sound or other phenomena.\n" +
      "Specific Description: Information technology software.",
    uqc: "NOS-NUMBERS"
  }
};

/* ------------------------------------------------------------------------------------------------
   FETCH B2B DATA (POS from GSTIN)
------------------------------------------------------------------------------------------------ */
async function fetchB2BData(startDate, endDate) {
  const query = `
    SELECT 
      O.bill_number AS invoice_number,
      DATE_FORMAT(O.order_date, '%Y-%m-%d') AS invoice_date,
      O.order_total_amount AS invoice_value,
      O.order_subtotal_amount AS taxable_value,
      C.gst_number AS recipient_gstin,
      C.company_billing AS receiver_name,
      (SELECT DISTINCT I.gst_rate FROM order_items I WHERE I.order_id = O.id LIMIT 1) AS gst_rate_applied
    FROM orders O
    INNER JOIN customers C ON O.customer_id = C.id
    WHERE C.gst_number IS NOT NULL AND C.gst_number != ''
      AND O.order_date BETWEEN :startDate AND :endDate
    ORDER BY O.order_date ASC;
  `;

  const rows = await sequelize.query(query, { replacements: { startDate, endDate }, type: QueryTypes.SELECT });

  return rows.map(r => {
    const gstin = r.recipient_gstin || "";
    const stateCode = gstin.substring(0, 2) || "97";
    const stateName = STATE_CODE_TO_NAME[stateCode] || "Others Territory";
    const placeOfSupply = `${stateCode}-${stateName}`;
    return {
      ...r,
      taxable_value: parseFloat(r.taxable_value || 0),
      invoice_value: parseFloat(r.invoice_value || 0),
      gst_rate_applied: parseFloat(r.gst_rate_applied || 0),
      place_of_supply: placeOfSupply
    };
  });
}

async function fetchB2BSummary(startDate, endDate) {
  const query = `
    SELECT 
      COUNT(DISTINCT C.id) AS num_recipients,
      COUNT(O.id) AS num_invoices,
      SUM(O.order_total_amount) AS total_invoice_value,
      SUM(O.order_subtotal_amount) AS total_taxable_value
    FROM orders O
    INNER JOIN customers C ON O.customer_id = C.id
    WHERE C.gst_number IS NOT NULL AND C.gst_number != ''
      AND O.order_date BETWEEN :startDate AND :endDate;
  `;
  const r = await sequelize.query(query, { replacements: { startDate, endDate }, type: QueryTypes.SELECT, plain: true });
  return {
    num_recipients: r.num_recipients || 0,
    num_invoices: r.num_invoices || 0,
    total_invoice_value: parseFloat(r.total_invoice_value || 0),
    total_taxable_value: parseFloat(r.total_taxable_value || 0)
  };
}

/* ------------------------------------------------------------------------------------------------
   FETCH B2CS DATA (NOW FIX POS)
------------------------------------------------------------------------------------------------ */
async function fetchB2CSData(startDate, endDate) {
  const query = `
    SELECT 
      C.state_name AS place_of_supply,
      I.gst_rate AS rate,
      SUM(I.unit_cost_at_sale * I.quantity) AS total_taxable_value
    FROM orders O
    INNER JOIN customers C ON O.customer_id = C.id
    INNER JOIN order_items I ON O.id = I.order_id
    WHERE (C.gst_number IS NULL OR C.gst_number = '')
      AND O.order_date BETWEEN :startDate AND :endDate
    GROUP BY C.state_name, I.gst_rate
    ORDER BY C.state_name, I.gst_rate;
  `;

  const rows = await sequelize.query(query, { replacements: { startDate, endDate }, type: QueryTypes.SELECT });

  return rows.map(r => ({
    place_of_supply: formatPlaceOfSupplyFromName(r.place_of_supply), // ✅ FIX APPLIED
    rate: parseFloat(r.rate || 0),
    total_taxable_value: parseFloat(r.total_taxable_value || 0)
  }));
}

/* ------------------------------------------------------------------------------------------------
   FETCH HSN SUMMARY (unchanged logic)
------------------------------------------------------------------------------------------------ */
async function fetchHSNData(startDate, endDate, isB2B) {
  const gstFilter = isB2B
    ? "C.gst_number IS NOT NULL AND C.gst_number != ''"
    : "(C.gst_number IS NULL OR C.gst_number = '')";

  const query = `
    SELECT 
      P.hsn_code AS hsn,
      P.item_name AS description,
      SUM(I.quantity) AS total_quantity,
      SUM(I.unit_cost_at_sale * I.quantity) AS taxable_value,
      SUM(I.order_line_tax) AS total_tax_amount,
      C.state_name AS customer_state
    FROM orders O
    INNER JOIN customers C ON O.customer_id = C.id
    INNER JOIN order_items I ON O.id = I.order_id
    INNER JOIN products P ON I.product_id = P.id
    WHERE ${gstFilter}
      AND O.order_date BETWEEN :startDate AND :endDate
    GROUP BY P.hsn_code, P.item_name, C.state_name
    ORDER BY P.hsn_code;
  `;

  const rows = await sequelize.query(query, { replacements: { startDate, endDate }, type: QueryTypes.SELECT });

  const grouped = {};

  rows.forEach(r => {
    const key = r.hsn || "99999999";
    if (!grouped[key]) {
      grouped[key] = {
        hsn: key,
        description: HSN_DESCRIPTION_MAP[key]?.description || r.description,
        uqc: HSN_DESCRIPTION_MAP[key]?.uqc || "NOS-NUMBERS",
        total_quantity: 0,
        taxable_value: 0,
        igst: 0, cgst: 0, sgst: 0, cess: 0
      };
    }

    grouped[key].total_quantity += parseFloat(r.total_quantity || 0);
    grouped[key].taxable_value += parseFloat(r.taxable_value || 0);

    const split = calculateGstSplit(r.total_tax_amount, r.customer_state);
    grouped[key].igst += split.igst;
    grouped[key].cgst += split.cgst;
    grouped[key].sgst += split.sgst;
  });

  return Object.values(grouped).map(r => ({
    ...r,
    total_value: (r.taxable_value + r.igst + r.cgst + r.sgst).toFixed(2),
    taxable_value: r.taxable_value.toFixed(2),
    igst: r.igst.toFixed(2),
    cgst: r.cgst.toFixed(2),
    sgst: r.sgst.toFixed(2),
    cess: r.cess.toFixed(2),
    rate: ""
  }));
}

/* ------------------------------------------------------------------------------------------------
   SHARED SHEET STYLE
------------------------------------------------------------------------------------------------ */
const GST_HEADER_STYLE = {
  font: { bold: true },
  fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCE6F1' } },
  alignment: { vertical: 'middle', horizontal: 'center', wrapText: true },
  border: { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } }
};
const BORDER = GST_HEADER_STYLE.border;

/* ------------------------------------------------------------------------------------------------
   B2B SHEET
------------------------------------------------------------------------------------------------ */
function addB2BSheet(workbook, data, summary) {
  const sheet = workbook.addWorksheet('B2B, SEZ, DE', { views: [{ state: 'frozen', ySplit: 4 }] });

  sheet.mergeCells('A1:M1');
  sheet.getCell('A1').value = 'Summary For B2B (4)';
  sheet.getCell('A1').font = { bold: true, size: 14 };

  sheet.getRow(2).values = ['No. of Recipients', '', 'No. of Invoices', '', 'Total Invoice Value', '', '', '', '', '', '', 'Taxable Value', 'Cess Amount'];
  sheet.getRow(3).values = [summary.num_recipients, '', summary.num_invoices, '', summary.total_invoice_value, '', '', '', '', '', '', summary.total_taxable_value, 0];

  const headers = [
    'GSTIN/UIN of Recipient', 'Receiver Name', 'Invoice Number', 'Invoice date',
    'Invoice Value', 'Place Of Supply', 'Reverse Charge', 'Applicable % Tax',
    'Invoice Type', 'E-Commerce GSTIN', 'Rate', 'Taxable Value', 'Cess Amount'
  ];
  sheet.getRow(4).values = headers;
  sheet.getRow(4).eachCell(c => c.style = GST_HEADER_STYLE);

  data.forEach(r => {
    const row = sheet.addRow([
      r.recipient_gstin, r.receiver_name, r.invoice_number, r.invoice_date,
      r.invoice_value, r.place_of_supply, 'N', '', 'Regular', '',
      r.gst_rate_applied, r.taxable_value, 0
    ]);
    row.eachCell(c => c.border = BORDER);
  });

  sheet.columns.forEach(col => col.width = 20);
}

/* ------------------------------------------------------------------------------------------------
   B2CS SHEET (UPDATED POS)
------------------------------------------------------------------------------------------------ */
function addB2CSSheet(workbook, rows) {
  const sheet = workbook.addWorksheet('B2CS');

  sheet.getCell('A1').value = 'Summary For B2CS (7)';
  sheet.getCell('A1').font = { bold: true, size: 14 };

  const totalTaxable = rows.reduce((sum, r) => sum + r.total_taxable_value, 0);
  sheet.getCell('E2').value = 'Total Taxable Value';
  sheet.getCell('E3').value = totalTaxable;

  const headers = ['Type', 'Place Of Supply', 'Applicable % Tax', 'Rate', 'Taxable Value', 'Cess Amount', 'E-Commerce GSTIN'];
  sheet.getRow(4).values = headers;
  sheet.getRow(4).eachCell(c => c.style = GST_HEADER_STYLE);

  rows.forEach(r => {
    const row = sheet.addRow(['Other than E-commerce', r.place_of_supply, '', r.rate, r.total_taxable_value, 0, '']);
    row.eachCell(c => c.border = BORDER);
  });

  sheet.columns.forEach(col => col.width = 20);
}

/* ------------------------------------------------------------------------------------------------
   CDNR SHEET
------------------------------------------------------------------------------------------------ */
function addCDNRSheet(workbook) {
  const sheet = workbook.addWorksheet("CDNR", { views: [{ state: 'frozen', ySplit: 4 }] });

  sheet.mergeCells('A1:M1');
  sheet.getCell("A1").value = "Summary For CDNR (9B)";
  sheet.getCell("A1").font = { bold: true, size: 14 };
  sheet.getCell("A1").alignment = { horizontal: 'center' };

  sheet.getRow(2).values = ["No. of Recipients", '', "No. of Notes", '', '', '', '', '', "Total Note Value", '', '', "Total Taxable Value", "Total Cess"];
  sheet.getRow(3).values = [0, '', 0, '', '', '', '', '', 0, '', '', 0, 0];

  const headers = [
    "GSTIN/UIN of Recipient","Receiver Name","Note Number","Note date","Note Type",
    "Place Of Supply","Reverse Charge","Note Supply Type","Note Value",
    "Applicable % of Tax Rate","Rate","Taxable Value","Cess Amount"
  ];
  sheet.getRow(4).values = headers;
  sheet.getRow(4).eachCell(c => c.style = GST_HEADER_STYLE);

  sheet.columns.forEach(col => col.width = 20);
}

/* ------------------------------------------------------------------------------------------------
   CDNUR SHEET
------------------------------------------------------------------------------------------------ */
function addCDNURSheet(workbook) {
  const sheet = workbook.addWorksheet("CDNUR", { views: [{ state: 'frozen', ySplit: 4 }] });

  sheet.mergeCells('A1:J1');
  sheet.getCell("A1").value = "Summary For CDNUR (9B)";
  sheet.getCell("A1").font = { bold: true, size: 14 };
  sheet.getCell("A1").alignment = { horizontal: 'center' };

  sheet.getRow(2).values = ["No. of Notes/Vouchers", '', '', '', '', "Total Note Value", '', "Total Taxable Value", "Total Cess"];
  sheet.getRow(3).values = [0, '', '', '', '', 0, '', 0, 0];

  const headers = [
    "UR Type", "Note Number", "Note date", "Note Type", "Place Of Supply",
    "Note Value", "Applicable % of Tax Rate", "Rate", "Taxable Value", "Cess Amount"
  ];
  sheet.getRow(4).values = headers;
  sheet.getRow(4).eachCell(c => c.style = GST_HEADER_STYLE);

  sheet.columns.forEach(col => col.width = 20);
}

/* ------------------------------------------------------------------------------------------------
   HSN SHEET
------------------------------------------------------------------------------------------------ */
function addHSNSheet(workbook, hsnData, sheetName, title) {
  const sheet = workbook.addWorksheet(sheetName, { views: [{ state: 'frozen', ySplit: 2 }] });

  sheet.mergeCells('A1:K1');
  sheet.getCell('A1').value = title;
  sheet.getCell('A1').font = { bold: true, size: 14 };
  sheet.getCell('A1').alignment = { horizontal: 'center' };

  const headers = [
    'HSN', 'Description', 'UQC', 'Total Quantity', 'Total Value', 'Rate',
    'Taxable Value', 'Integrated Tax Amount', 'Central Tax Amount', 'State/UT Tax Amount', 'Cess Amount'
  ];
  sheet.getRow(2).values = headers;
  sheet.getRow(2).eachCell(c => c.style = GST_HEADER_STYLE);

  let rowIndex = 3;
  hsnData.forEach(r => {
    const row = sheet.getRow(rowIndex++);
    row.values = [
      r.hsn, r.description, r.uqc, r.total_quantity,
      r.total_value, '', r.taxable_value, r.igst, r.cgst, r.sgst, r.cess
    ];
    row.eachCell(c => (c.border = BORDER));
  });

  sheet.getColumn(2).width = 45;
  sheet.getColumn(2).alignment = { wrapText: true };
}

/* ------------------------------------------------------------------------------------------------
   MAIN FUNCTION
------------------------------------------------------------------------------------------------ */
async function generateGstr1Report(startDate, endDate) {
  const b2bData = await fetchB2BData(startDate, endDate);
  const b2bSummary = await fetchB2BSummary(startDate, endDate);
  const b2csData = await fetchB2CSData(startDate, endDate);
  const hsnB2B = await fetchHSNData(startDate, endDate, true);
  const hsnB2C = await fetchHSNData(startDate, endDate, false);

  const filename = `GNX-GSTR1-${startDate.replace(/-/g,'')}-${endDate.replace(/-/g,'')}-${Date.now()}.xlsx`;
  const downloads = path.join(__dirname, '..', 'downloads');
  await fs.mkdir(downloads, { recursive: true });
  const filePath = path.join(downloads, filename);

  const workbook = new ExcelJS.Workbook();
  addB2BSheet(workbook, b2bData, b2bSummary);
  addB2CSSheet(workbook, b2csData);
  addCDNRSheet(workbook);
  addCDNURSheet(workbook);
  addHSNSheet(workbook, hsnB2B, "HSN (B2B)", "Summary For HSN B2B");
  addHSNSheet(workbook, hsnB2C, "HSN (B2C)", "Summary For HSN B2C");

  await workbook.xlsx.writeFile(filePath);
  return path.join("downloads", filename);
}

module.exports = { generateGstr1Report };
