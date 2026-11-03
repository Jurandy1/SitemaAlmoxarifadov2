const pad2 = (n) => String(n).padStart(2, "0");

/** Limites para não travar o navegador com planilhas de intervalo “fantasma” (Excel !ref enorme). */
export const SHEET_MAX_ROWS = 500;
export const SHEET_MAX_COLS = 40;
export const SHEET_READ_OPTS = {
  type: "array",
  cellDates: true,
  sheetRows: SHEET_MAX_ROWS,
};

/**
 * Corta o !ref da planilha para no máximo maxRows × maxCols.
 * Planilhas “sujas” às vezes declaram até a linha 1.048.576 — sheet_to_json
 * aloca tudo isso e o site congela até fechar a aba.
 */
function clampSheetRef(ws, maxRows = SHEET_MAX_ROWS, maxCols = SHEET_MAX_COLS) {
  if (!ws || typeof ws !== "object") return;

  let range;
  try {
    range = ws["!ref"]
      ? XLSX.utils.decode_range(ws["!ref"])
      : { s: { r: 0, c: 0 }, e: { r: 0, c: 0 } };
  } catch (_) {
    range = { s: { r: 0, c: 0 }, e: { r: 0, c: 0 } };
  }

  const spanR = range.e.r - range.s.r + 1;
  const spanC = range.e.c - range.s.c + 1;

  if (spanR > maxRows || spanC > maxCols || !ws["!ref"]) {
    let maxR = range.s.r;
    let maxC = range.s.c;
    let found = false;
    // Poucas células reais + !ref enorme: varrer as chaves é barato e acerta o uso real.
    for (const key of Object.keys(ws)) {
      if (key.charAt(0) === "!") continue;
      let cell;
      try {
        cell = XLSX.utils.decode_cell(key);
      } catch (_) {
        continue;
      }
      if (cell.r > maxR) maxR = cell.r;
      if (cell.c > maxC) maxC = cell.c;
      found = true;
    }
    if (found) {
      range.e.r = Math.min(maxR, range.s.r + maxRows - 1);
      range.e.c = Math.min(maxC, range.s.c + maxCols - 1);
    } else {
      range.e.r = Math.min(range.e.r, range.s.r + maxRows - 1);
      range.e.c = Math.min(range.e.c, range.s.c + maxCols - 1);
    }
  }

  if (range.e.r < range.s.r) range.e.r = range.s.r;
  if (range.e.c < range.s.c) range.e.c = range.s.c;
  ws["!ref"] = XLSX.utils.encode_range(range);
}

function trimEmptyTrailingRows(rows) {
  let end = rows.length;
  while (end > 0) {
    const r = rows[end - 1] || [];
    if (r.some((c) => String(c ?? "").trim() !== "")) break;
    end--;
  }
  return end < rows.length ? rows.slice(0, end) : rows;
}

function getSafeRows(ws, opts = {}) {
  const maxRows = opts.maxRows || SHEET_MAX_ROWS;
  const maxCols = opts.maxCols || SHEET_MAX_COLS;
  clampSheetRef(ws, maxRows, maxCols);

  const rawRows = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    defval: "",
    blankrows: false,
  });

  const capped = rawRows.slice(0, maxRows).map((r) => {
    const row = Array.isArray(r) ? r.slice(0, maxCols) : [];
    return row.map((c) => {
      if (c instanceof Date) {
        const ud = c.getUTCDate(),
          um = c.getUTCMonth() + 1,
          uy = c.getUTCFullYear();
        const ld = c.getDate(),
          lm = c.getMonth() + 1,
          ly = c.getFullYear();
        const d = ud !== ld && ly >= 2000 ? ld : ud;
        const mo = ud !== ld && ly >= 2000 ? lm : um;
        const y = ud !== ld && ly >= 2000 ? ly : uy;
        return pad2(d) + "/" + pad2(mo) + "/" + y;
      }
      if (typeof c === "number" && c > 30000 && c < 60000) {
        try {
          const dt = new Date((c - 25569) * 86400000);
          if (!isNaN(dt.getTime()) && dt.getFullYear() >= 2000)
            return pad2(dt.getUTCDate()) + "/" + pad2(dt.getUTCMonth() + 1) + "/" + dt.getUTCFullYear();
        } catch (_) {}
      }
      return c;
    });
  });

  return trimEmptyTrailingRows(capped);
}

function isDocxFile(name) {
  return /\.docx?$/i.test(name || "");
}

function isOdtFile(name) {
  return /\.odt$/i.test(name || "");
}

function isPdfFile(name) {
  return /\.pdf$/i.test(name || "");
}

async function odtToRows(arrayBuffer) {
  let xmlText = "";
  if (typeof JSZip !== "undefined") {
    const zip = await JSZip.loadAsync(arrayBuffer);
    const contentFile = zip.file("content.xml");
    if (!contentFile) throw new Error("ODT sem content.xml");
    xmlText = await contentFile.async("string");
  } else {
    throw new Error("JSZip não carregado.");
  }

  const doc = new DOMParser().parseFromString(xmlText, "text/xml");
  const NS_TEXT = "urn:oasis:names:tc:opendocument:xmlns:text:1.0";
  const NS_TABLE = "urn:oasis:names:tc:opendocument:xmlns:table:1.0";
  const NS_OFFICE = "urn:oasis:names:tc:opendocument:xmlns:office:1.0";

  function extractCellText(cell) {
    const parts = [];
    const paras = cell.getElementsByTagNameNS(NS_TEXT, "p");
    if (paras.length > 0) {
      for (let pi = 0; pi < paras.length; pi++) {
        const spans = paras[pi].getElementsByTagNameNS(NS_TEXT, "span");
        if (spans.length > 0) {
          const spanTexts = [];
          for (let si = 0; si < spans.length; si++) {
            const t = (spans[si].textContent || "").trim();
            if (t) spanTexts.push(t);
          }
          if (spanTexts.length) parts.push(spanTexts.join(" "));
          else {
            const t = (paras[pi].textContent || "").trim();
            if (t) parts.push(t);
          }
        } else {
          const t = (paras[pi].textContent || "").trim();
          if (t) parts.push(t);
        }
      }
    } else {
      const t = (cell.textContent || "").trim();
      if (t) parts.push(t);
    }
    return parts.join(" ").replace(/\s+/g, " ").trim();
  }

  const rows = [];
  const body =
    doc.getElementsByTagNameNS(NS_OFFICE, "text")[0] || doc.getElementsByTagNameNS(NS_OFFICE, "body")[0];
  if (!body) return rows;

  const children = body.children || body.childNodes;
  for (let ci = 0; ci < children.length; ci++) {
    const el = children[ci];

    if (el.localName === "p") {
      const txt = extractCellText(el);
      if (txt && txt.length > 2) {
        rows.push([txt]);
      }
    }

    if (el.localName === "table") {
      const trs = el.getElementsByTagNameNS(NS_TABLE, "table-row");
      for (let ri = 0; ri < trs.length; ri++) {
        if (rows.length >= SHEET_MAX_ROWS) break;
        const tr = trs[ri];
        const cells = tr.getElementsByTagNameNS(NS_TABLE, "table-cell");
        const rowData = [];
        for (let xi = 0; xi < cells.length; xi++) {
          if (rowData.length >= SHEET_MAX_COLS) break;
          const cell = cells[xi];
          const repeat = parseInt(cell.getAttribute("table:number-columns-repeated") || "1", 10);
          const text = extractCellText(cell);
          if (repeat > 10 && !text) continue;
          for (let rp = 0; rp < Math.min(repeat, 6); rp++) {
            if (rowData.length >= SHEET_MAX_COLS) break;
            rowData.push(text);
          }
        }
        while (rowData.length > 0 && !rowData[rowData.length - 1]) rowData.pop();
        if (rowData.length > 0 && rowData.some((c) => c)) rows.push(rowData);
      }
    }
  }

  return rows.slice(0, SHEET_MAX_ROWS);
}

async function docxToRows(arrayBuffer) {
  if (typeof mammoth === "undefined") throw new Error("mammoth.js não carregado");
  const result = await mammoth.convertToHtml({ arrayBuffer });
  const doc = new DOMParser().parseFromString(result.value, "text/html");
  const rows = [];
  doc.querySelectorAll("table tr").forEach((tr) => {
    if (rows.length >= SHEET_MAX_ROWS) return;
    const cells = [];
    tr.querySelectorAll("td, th").forEach((td) => {
      if (cells.length >= SHEET_MAX_COLS) return;
      cells.push(td.textContent.replace(/\s+/g, " ").trim());
    });
    if (cells.some((c) => c)) rows.push(cells);
  });
  if (!rows.length) {
    const textResult = await mammoth.extractRawText({ arrayBuffer });
    const lines = textResult.value.split("\n").filter((l) => l.trim());
    lines.forEach((l) => {
      if (rows.length < SHEET_MAX_ROWS) rows.push([l.trim()]);
    });
  }
  return rows.slice(0, SHEET_MAX_ROWS);
}

export { getSafeRows, clampSheetRef, isDocxFile, isOdtFile, isPdfFile, odtToRows, docxToRows };
