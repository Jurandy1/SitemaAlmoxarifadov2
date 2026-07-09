const pad2 = (n) => String(n).padStart(2, "0");

function getSafeRows(ws) {
  const rawRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
  return rawRows.map((r) =>
    r.map((c) => {
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
    })
  );
}

function isDocxFile(name) {
  return /\.docx?$/i.test(name || "");
}

function isOdtFile(name) {
  return /\.odt$/i.test(name || "");
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
        const tr = trs[ri];
        const cells = tr.getElementsByTagNameNS(NS_TABLE, "table-cell");
        const rowData = [];
        for (let xi = 0; xi < cells.length; xi++) {
          const cell = cells[xi];
          const repeat = parseInt(cell.getAttribute("table:number-columns-repeated") || "1");
          const text = extractCellText(cell);
          if (repeat > 10 && !text) continue;
          for (let rp = 0; rp < Math.min(repeat, 6); rp++) {
            rowData.push(text);
          }
        }
        while (rowData.length > 0 && !rowData[rowData.length - 1]) rowData.pop();
        if (rowData.length > 0 && rowData.some((c) => c)) rows.push(rowData);
      }
    }
  }

  return rows;
}

async function docxToRows(arrayBuffer) {
  if (typeof mammoth === "undefined") throw new Error("mammoth.js não carregado");
  const result = await mammoth.convertToHtml({ arrayBuffer });
  const doc = new DOMParser().parseFromString(result.value, "text/html");
  const rows = [];
  doc.querySelectorAll("table tr").forEach((tr) => {
    const cells = [];
    tr.querySelectorAll("td, th").forEach((td) => {
      cells.push(td.textContent.replace(/\s+/g, " ").trim());
    });
    if (cells.some((c) => c)) rows.push(cells);
  });
  if (!rows.length) {
    const textResult = await mammoth.extractRawText({ arrayBuffer });
    const lines = textResult.value.split("\n").filter((l) => l.trim());
    lines.forEach((l) => rows.push([l.trim()]));
  }
  return rows;
}

export { getSafeRows, isDocxFile, isOdtFile, odtToRows, docxToRows };
