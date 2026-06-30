// Generates a representational SVG "page" for demo uploads, so the capture →
// review flow has an image to show beside each field even without a camera.
// Real uploads use the actual photo bytes instead.

const LINES: Record<string, { title: string; rows: string[] }> = {
  product_list: {
    title: "ԳՆԱՑՈՒՑԱԿ · Price list",
    rows: [
      "Մարաշ կախազարդ · կապույտ   3200 / 9000",
      "Մարաշ կախազարդ · կարմիր    3200 / 9000",
      "Արծաթե մատանի · M          5400 / 14000",
      "Արծնապակի ականջող · teal   2800 / 7500",
    ],
  },
  sales_sheet: {
    title: "ՎԱՃԱՌՔ · Cascade · Երեք",
    rows: [
      "Մարաշ կապույտ      3 x 9000  = 27000",
      "մատանի M           1 x 14000 = 14000",
      "ականջող teal       2 x 7500  = 15000",
      "Մարաշ ???          1 x 9000  = 9000",
      "—— total 61500 ——",
    ],
  },
  expense: {
    title: "ԾԱԽՍ · Receipt",
    rows: [
      "22/06  Tar? Pr??t   packaging   18500",
      "22/06  GG Taxi      transport    3200",
    ],
  },
  stock_count: {
    title: "ՊԱՇԱՐ · Megamall · 25/06",
    rows: [
      "Մարաշ կապույտ   12",
      "մատանի M         4",
      "ականջող teal     7",
    ],
  },
};

export function demoPageSvg(docType: string): string {
  const doc = LINES[docType] ?? LINES.product_list;
  const rows = doc.rows
    .map((r, i) => `<text x="60" y="${190 + i * 70}" font-size="30" fill="#1b2433" font-family="Comic Sans MS, cursive">${escapeXml(r)}</text>`)
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1040" viewBox="0 0 800 1040">
  <rect width="800" height="1040" fill="#f6f1e7"/>
  <rect x="24" y="24" width="752" height="992" fill="#fffdf8" stroke="#d9cdb6" stroke-width="3"/>
  <text x="60" y="110" font-size="40" fill="#0c1118" font-family="Georgia, serif" font-weight="bold">${escapeXml(doc.title)}</text>
  <line x1="60" y1="135" x2="740" y2="135" stroke="#c9bda4" stroke-width="2"/>
  ${rows}
  <text x="60" y="980" font-size="20" fill="#8b7d5e" font-family="Georgia, serif">PaperLens demo page · ${escapeXml(docType)}</text>
</svg>`;
}

export function demoPageDataUrl(docType: string): string {
  const svg = demoPageSvg(docType);
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]!));
}
