import ExcelJS from 'exceljs';
import { COLUMNS, cellValue } from '../../../lib/columns';
import type { Business } from '../../../lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Builds an .xlsx from the rows currently shown in the table (i.e. after filters). */
export async function POST(req: Request) {
  let rows: Business[];
  try {
    const body = await req.json();
    rows = Array.isArray(body?.rows) ? body.rows : [];
  } catch {
    return Response.json({ error: 'Request body must be JSON.' }, { status: 400 });
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = 'lead';
  const ws = wb.addWorksheet('Businesses', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = COLUMNS.map((c) => ({
    header: c.label,
    key: c.key,
    width: c.key === 'description' ? 60 : c.key === 'name' ? 34 : c.key === 'street' ? 30 : c.key === 'categories' ? 32 : 24,
  }));
  for (const r of rows) {
    const row: Record<string, string> = {};
    for (const c of COLUMNS) row[c.key] = cellValue(r, c.key);
    ws.addRow(row);
  }
  const header = ws.getRow(1);
  header.font = { bold: true };
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLUMNS.length } };

  // Make links clickable.
  for (const key of ['website', 'facebook', 'instagram', 'linkedin', 'twitter', 'googleMapsUrl', 'memberUrl'] as const) {
    const col = ws.getColumn(key);
    col.eachCell((cell, rowNumber) => {
      if (rowNumber > 1 && typeof cell.value === 'string' && /^https?:\/\//.test(cell.value)) {
        cell.value = { text: cell.value, hyperlink: cell.value };
      }
    });
  }

  const buf = await wb.xlsx.writeBuffer();
  return new Response(buf as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="lead-export.xlsx"',
      'Cache-Control': 'no-store',
    },
  });
}
