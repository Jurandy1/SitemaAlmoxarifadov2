/**
 * Relatório PCA em PDF e Word, com brasão da Prefeitura e cabeçalho do setor.
 * Recebe as seções já montadas (secoesPca) — a mesma estrutura que a tela usa.
 */
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  ImageRun,
  Packer,
  PageNumber,
  PageOrientation,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from "docx";

const PREFEITURA = "PREFEITURA DE SÃO LUÍS";
const SECRETARIA = "Secretaria Municipal da Criança e Assistência Social - SEMCAS";
const AZUL = [29, 78, 216];
const AZUL_HEX = "1D4ED8";
const BRASAO_PROPORCAO = 2362 / 3733; // largura / altura do brasão original

let _brasao = null;

// Brasão reduzido (o original tem 2362×3733 px e deixaria o arquivo pesado)
async function carregarBrasao() {
  if (_brasao) return _brasao;
  const url = (import.meta.env?.BASE_URL || "/") + "brasao-sao-luis.png";
  const img = await new Promise((ok, falha) => {
    const i = new Image();
    i.onload = () => ok(i);
    i.onerror = () => falha(new Error("Brasão não encontrado"));
    i.src = url;
  });
  const altura = 300;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(altura * BRASAO_PROPORCAO);
  canvas.height = altura;
  canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL("image/png");
  const bin = atob(dataUrl.split(",")[1]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  _brasao = { dataUrl, bytes };
  return _brasao;
}

function baixar(blob, nome) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

const linhasInfo = (info) =>
  [
    ["Período", `${info.periodo} (${info.base})`],
    ["Categorias", info.categorias],
    info.filtros ? ["Filtros", info.filtros] : null,
    ["Gerado em", info.geradoEm],
  ].filter(Boolean);

const LEGENDA =
  "Solicitado = tudo o que as unidades pediram, mesmo o que não foi atendido. Atendido = o que foi entregue. " +
  "Necessidade anual = média mensal do solicitado × 12 (quantidade que atenderia as unidades pelo que elas pedem). " +
  "Estimativa anual = média mensal do atendido × 12. As unidades da sede aparecem juntas, numa linha só.";

// ─── PDF ──────────────────────────────────────────────────────────
export async function gerarPdfPca(info, secoes) {
  const brasao = await carregarBrasao().catch(() => null);
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const M = 12;

  // Cabeçalho
  const hBrasao = 24;
  if (brasao) doc.addImage(brasao.dataUrl, "PNG", M, 8, hBrasao * BRASAO_PROPORCAO, hBrasao);
  const xt = M + hBrasao * BRASAO_PROPORCAO + 5;
  doc.setTextColor(15, 23, 42);
  doc.setFont("helvetica", "bold").setFontSize(12).text(PREFEITURA, xt, 15);
  doc.setFont("helvetica", "normal").setFontSize(9).text(SECRETARIA, xt, 21);
  doc.setFont("helvetica", "bold").setFontSize(10).setTextColor(...AZUL).text(info.setor, xt, 27);
  doc.setTextColor(15, 23, 42).setFontSize(13).text(info.titulo || "Relatório de Consumo de Materiais", W - M, 15, { align: "right" });
  doc.setFont("helvetica", "normal").setFontSize(10).text(`Subsídio para o PCA ${info.anoPca}`, W - M, 21, { align: "right" });
  doc.setDrawColor(...AZUL).setLineWidth(0.6).line(M, 35, W - M, 35);

  let y = 41;
  doc.setFontSize(9);
  for (const [k, v] of linhasInfo(info)) {
    doc.setFont("helvetica", "bold").text(`${k}:`, M, y);
    doc.setFont("helvetica", "normal");
    const linhas = doc.splitTextToSize(v, W - M * 2 - 24);
    doc.text(linhas, M + 24, y);
    y += 5 * linhas.length;
  }

  // Indicadores
  const nK = info.kpis.length;
  const gap = 4;
  const wK = (W - M * 2 - gap * (nK - 1)) / nK;
  y += 1;
  info.kpis.forEach(([rot, val], i) => {
    const x = M + i * (wK + gap);
    doc.setDrawColor(203, 213, 225).setFillColor(248, 250, 252).roundedRect(x, y, wK, 15, 1.5, 1.5, "FD");
    doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(100, 116, 139).text(rot, x + 3, y + 5);
    doc.setFont("helvetica", "bold").setFontSize(13).setTextColor(...(i === (info.kpiDestaque ?? 3) ? AZUL : [15, 23, 42])).text(val, x + 3, y + 12);
  });
  y += 20;
  doc.setFont("helvetica", "italic").setFontSize(7.5).setTextColor(71, 85, 105);
  const leg = doc.splitTextToSize(info.legenda || LEGENDA, W - M * 2);
  doc.text(leg, M, y);
  y += 3.5 * leg.length + 3;

  for (const sec of secoes) {
    if (y > 180) {
      doc.addPage();
      y = 16;
    }
    doc.setFont("helvetica", "bold").setFontSize(11).setTextColor(15, 23, 42).text(sec.titulo, M, y);
    if (sec.sub) doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(100, 116, 139).text(sec.sub, M + doc.getTextWidth(sec.titulo) * (11 / 8) + 4, y);
    const colNecessidade = sec.cols.findIndex((c) => c.destaque || /^Necessidade/.test(c.t));
    autoTable(doc, {
      startY: y + 2,
      margin: { left: M, right: M, top: 14, bottom: 14 },
      head: [sec.cols.map((c) => c.t)],
      body: sec.linhas.map((l) => l.cels.map((c) => c.s)),
      theme: "grid",
      styles: { fontSize: 7, cellPadding: 1.4, textColor: [15, 23, 42], lineColor: [226, 232, 240], lineWidth: 0.2, overflow: "linebreak" },
      headStyles: { fillColor: [241, 245, 249], textColor: [30, 41, 59], fontStyle: "bold", valign: "middle" },
      columnStyles: Object.fromEntries(sec.cols.map((c, i) => [i, c.num ? { halign: "right" } : {}])),
      didParseCell: (d) => {
        if (d.section === "head" && sec.cols[d.column.index]?.num) d.cell.styles.halign = "right";
        if (d.section !== "body") return;
        if (sec.linhas[d.row.index]?.total) {
          d.cell.styles.fontStyle = "bold";
          d.cell.styles.fillColor = [241, 245, 249];
        } else if (d.column.index === colNecessidade) {
          d.cell.styles.fontStyle = "bold";
          d.cell.styles.fillColor = [239, 246, 255];
        }
      },
    });
    y = doc.lastAutoTable.finalY + 9;
  }

  // Rodapé com o setor e a paginação
  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    const H = doc.internal.pageSize.getHeight();
    doc.setFont("helvetica", "normal").setFontSize(7.5).setTextColor(100, 116, 139);
    doc.text(`${PREFEITURA} · SEMCAS · ${info.setor}`, M, H - 7);
    doc.text(`Página ${p} de ${total}`, W - M, H - 7, { align: "right" });
  }

  doc.save(`${info.nomeArquivo}.pdf`);
}

// ─── Word (.docx) ─────────────────────────────────────────────────
const SEM_BORDA = {
  top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
};
const BORDA_FINA = {
  top: { style: BorderStyle.SINGLE, size: 2, color: "CBD5E1" },
  bottom: { style: BorderStyle.SINGLE, size: 2, color: "CBD5E1" },
  left: { style: BorderStyle.SINGLE, size: 2, color: "CBD5E1" },
  right: { style: BorderStyle.SINGLE, size: 2, color: "CBD5E1" },
};

const texto = (t, o = {}) => new TextRun({ text: String(t ?? ""), font: "Calibri", size: o.size || 18, bold: o.bold, italics: o.italics, color: o.color });
const par = (t, o = {}) =>
  new Paragraph({ alignment: o.align, spacing: { before: o.before || 0, after: o.after ?? 60 }, children: Array.isArray(t) ? t : [texto(t, o)] });

function celula(t, o = {}) {
  return new TableCell({
    borders: o.borders || BORDA_FINA,
    shading: o.fill ? { type: ShadingType.CLEAR, color: "auto", fill: o.fill } : undefined,
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 30, bottom: 30, left: 60, right: 60 },
    width: o.width,
    children: Array.isArray(t) ? t : [par(t, { size: o.size || 14, bold: o.bold, align: o.align, after: 0, color: o.color })],
  });
}

function tabelaSecao(sec) {
  const colNecessidade = sec.cols.findIndex((c) => c.destaque || /^Necessidade/.test(c.t));
  const cab = new TableRow({
    tableHeader: true,
    children: sec.cols.map((c) => celula(c.t, { bold: true, fill: "F1F5F9", align: c.num ? AlignmentType.RIGHT : AlignmentType.LEFT })),
  });
  const linhas = sec.linhas.map(
    (l) =>
      new TableRow({
        children: l.cels.map((c, i) =>
          celula(c.s, {
            bold: l.total || i === colNecessidade,
            fill: l.total ? "F1F5F9" : i === colNecessidade ? "EFF6FF" : undefined,
            align: sec.cols[i]?.num ? AlignmentType.RIGHT : AlignmentType.LEFT,
          })
        ),
      })
  );
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [cab, ...linhas] });
}

export async function gerarWordPca(info, secoes) {
  const brasao = await carregarBrasao().catch(() => null);
  const hImg = 78;

  const cabecalho = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: [
          celula(
            brasao
              ? [new Paragraph({ children: [new ImageRun({ type: "png", data: brasao.bytes, transformation: { width: Math.round(hImg * BRASAO_PROPORCAO), height: hImg } })] })]
              : [par("")],
            { borders: SEM_BORDA, width: { size: 8, type: WidthType.PERCENTAGE } }
          ),
          celula(
            [
              par(PREFEITURA, { bold: true, size: 24, after: 20 }),
              par(SECRETARIA, { size: 18, after: 20 }),
              par(info.setor, { bold: true, size: 20, color: AZUL_HEX, after: 0 }),
            ],
            { borders: SEM_BORDA, width: { size: 55, type: WidthType.PERCENTAGE } }
          ),
          celula(
            [
              par(info.titulo || "Relatório de Consumo de Materiais", { bold: true, size: 26, align: AlignmentType.RIGHT, after: 20 }),
              par(`Subsídio para o PCA ${info.anoPca}`, { size: 20, align: AlignmentType.RIGHT, after: 0 }),
            ],
            { borders: SEM_BORDA, width: { size: 37, type: WidthType.PERCENTAGE } }
          ),
        ],
      }),
    ],
  });

  const info1 = linhasInfo(info).map(([k, v]) => par([texto(`${k}: `, { bold: true }), texto(v)], { after: 20 }));

  const kpis = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: info.kpis.map(([rot, val], i) =>
          celula([par(rot, { size: 15, color: "64748B", after: 20 }), par(val, { size: 26, bold: true, color: i === (info.kpiDestaque ?? 3) ? AZUL_HEX : "0F172A", after: 0 })], {
            fill: "F8FAFC",
          })
        ),
      }),
    ],
  });

  const corpo = [];
  for (const sec of secoes) {
    corpo.push(
      par([texto(sec.titulo, { bold: true, size: 22 }), ...(sec.sub ? [texto("   " + sec.sub, { size: 15, color: "64748B" })] : [])], { before: 240, after: 80 })
    );
    corpo.push(tabelaSecao(sec));
  }

  const doc = new Document({
    creator: info.setor,
    title: `${info.titulo || "Relatório de Consumo de Materiais"} - PCA ${info.anoPca}`,
    sections: [
      {
        properties: {
          page: {
            size: { orientation: PageOrientation.LANDSCAPE },
            margin: { top: 720, bottom: 720, left: 720, right: 720 },
          },
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  texto(`${PREFEITURA} · SEMCAS · ${info.setor}    Página `, { size: 15, color: "64748B" }),
                  new TextRun({ children: [PageNumber.CURRENT], size: 15, color: "64748B", font: "Calibri" }),
                  texto(" de ", { size: 15, color: "64748B" }),
                  new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 15, color: "64748B", font: "Calibri" }),
                ],
              }),
            ],
          }),
        },
        children: [
          cabecalho,
          new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: AZUL_HEX, space: 1 } }, spacing: { after: 120 }, children: [] }),
          ...info1,
          new Paragraph({ spacing: { after: 60 }, children: [] }),
          kpis,
          par(info.legenda || LEGENDA, { italics: true, size: 15, color: "475569", before: 100, after: 60 }),
          ...corpo,
        ],
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  baixar(blob, `${info.nomeArquivo}.docx`);
}
