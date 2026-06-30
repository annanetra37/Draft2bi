import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Deterministic PRNG so the demo dataset is identical on every seed.
let _s = 1337;
function rand() {
  _s = (_s * 1103515245 + 12345) & 0x7fffffff;
  return _s / 0x7fffffff;
}
const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
const between = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));

const DAY = 86400000;

async function main() {
  console.log("Resetting demo data…");
  // Order matters for FKs.
  await prisma.stockMovement.deleteMany();
  await prisma.sale.deleteMany();
  await prisma.expense.deleteMany();
  await prisma.billOfMaterials.deleteMany();
  await prisma.stock.deleteMany();
  await prisma.reviewItem.deleteMany();
  await prisma.stagedRow.deleteMany();
  await prisma.correctionExample.deleteMany();
  await prisma.sourceImage.deleteMany();
  await prisma.variant.deleteMany();
  await prisma.product.deleteMany();
  await prisma.rawMaterial.deleteMany();
  await prisma.sellingPoint.deleteMany();

  // --- selling points (a real multi-kiosk operation) ---
  const cascade = await prisma.sellingPoint.create({ data: { name: "Cascade", location: "Yerevan · Cascade", type: "kiosk" } });
  const megamall = await prisma.sellingPoint.create({ data: { name: "Megamall", location: "Yerevan · Megamall", type: "kiosk" } });
  const online = await prisma.sellingPoint.create({ data: { name: "Online", type: "online" } });
  const points = [cascade, megamall, online];

  // --- raw materials (the inputs) ---
  const silver = await prisma.rawMaterial.create({ data: { name: "Silver 925", unit: "g", qtyOnHand: 520, costPerUnit: 95, reorderThreshold: 200 } });
  const enamel = await prisma.rawMaterial.create({ data: { name: "Enamel", unit: "g", qtyOnHand: 180, costPerUnit: 40, reorderThreshold: 100 } });
  const thread = await prisma.rawMaterial.create({ data: { name: "Thread", unit: "m", qtyOnHand: 320, costPerUnit: 12, reorderThreshold: 100 } });
  const giftbox = await prisma.rawMaterial.create({ data: { name: "Gift box", unit: "pcs", qtyOnHand: 90, costPerUnit: 180, reorderThreshold: 50 } });

  // --- catalogue: products + variants ---
  async function product(name: string, category: string, variants: { label: string; attrs: any; cost: number; sell: number; bom: { m: string; q: number }[] }[]) {
    const p = await prisma.product.create({ data: { name, category } });
    const created = [];
    for (const v of variants) {
      const variant = await prisma.variant.create({
        data: { productId: p.id, label: v.label, attributes: JSON.stringify(v.attrs), unit: "pcs", costPrice: v.cost, sellPrice: v.sell, currency: "AMD" },
      });
      const mats: Record<string, string> = { silver: silver.id, enamel: enamel.id, thread: thread.id, giftbox: giftbox.id };
      for (const b of v.bom) {
        await prisma.billOfMaterials.create({ data: { variantId: variant.id, rawMaterialId: mats[b.m], qtyUsed: b.q } });
      }
      created.push(variant);
    }
    return created;
  }

  const [marashBlue, marashRed] = await product("Marash pendant", "Pendants", [
    { label: "Marash pendant — blue", attrs: { color: "blue" }, cost: 3200, sell: 9000, bom: [{ m: "silver", q: 6 }, { m: "enamel", q: 4 }, { m: "giftbox", q: 1 }] },
    { label: "Marash pendant — red", attrs: { color: "red" }, cost: 3200, sell: 9000, bom: [{ m: "silver", q: 6 }, { m: "enamel", q: 4 }, { m: "giftbox", q: 1 }] },
  ]);
  const [ringM, ringL] = await product("Silver ring", "Rings", [
    { label: "Silver ring — size M", attrs: { size: "M" }, cost: 5400, sell: 14000, bom: [{ m: "silver", q: 9 }, { m: "giftbox", q: 1 }] },
    { label: "Silver ring — size L", attrs: { size: "L" }, cost: 5800, sell: 15000, bom: [{ m: "silver", q: 11 }, { m: "giftbox", q: 1 }] },
  ]);
  const [earTeal, earRose] = await product("Enamel earrings", "Earrings", [
    { label: "Enamel earrings — teal", attrs: { color: "teal" }, cost: 2800, sell: 7500, bom: [{ m: "silver", q: 3 }, { m: "enamel", q: 5 }, { m: "thread", q: 0.5 }, { m: "giftbox", q: 1 }] },
    { label: "Enamel earrings — rose", attrs: { color: "rose" }, cost: 2800, sell: 7500, bom: [{ m: "silver", q: 3 }, { m: "enamel", q: 5 }, { m: "thread", q: 0.5 }, { m: "giftbox", q: 1 }] },
  ]);

  // Relative demand weights — Marash blue is the runaway best seller; rose
  // earrings never sell (becomes dead stock); ring L is a slow, high-margin mover.
  const catalogue = [
    { v: marashBlue, weight: 5, points: [cascade, megamall, online] },
    { v: marashRed, weight: 3, points: [cascade, megamall] },
    { v: ringM, weight: 2, points: [cascade, megamall, online] },
    { v: ringL, weight: 1, points: [megamall] },
    { v: earTeal, weight: 3, points: [cascade, megamall, online] },
    { v: earRose, weight: 0, points: [] }, // intentionally no sales
  ];

  // --- generate ~45 days of sales ---
  const today = new Date();
  today.setUTCHours(12, 0, 0, 0);
  const DAYS = 45;
  let saleCount = 0;

  for (let d = DAYS - 1; d >= 0; d--) {
    const date = new Date(today.getTime() - d * DAY);
    const weekend = [0, 6].includes(date.getUTCDay());
    const transactions = between(2, weekend ? 7 : 5);
    for (let t = 0; t < transactions; t++) {
      // Weighted variant pick.
      const pool = catalogue.flatMap((c) => Array(c.weight).fill(c)).filter((c) => c.weight > 0);
      const choice = pick(pool);
      const variant = choice.v;
      const sp = pick(choice.points) as { id: string };
      const qty = between(1, 3);
      const unitPrice = variant.sellPrice;
      const total = qty * unitPrice;
      await prisma.sale.create({
        data: { variantId: variant.id, sellingPointId: sp.id, date, qty, unitPrice, total, currency: "AMD", paymentMethod: pick(["cash", "cash", "card", "transfer"]) },
      });
      await prisma.stockMovement.create({ data: { variantId: variant.id, sellingPointId: sp.id, qtyDelta: -qty, reason: "sale", date } });

      // Consume raw materials via BOM (drives material-runway metrics).
      const bom = await prisma.billOfMaterials.findMany({ where: { variantId: variant.id } });
      for (const b of bom) {
        await prisma.stockMovement.create({ data: { rawMaterialId: b.rawMaterialId, qtyDelta: -(b.qtyUsed * qty), reason: "bom_consume", date } });
      }
      saleCount++;
    }
  }

  // --- current stock on hand per variant per location ---
  // Fast movers left low (triggers reorder-now); rose earrings stocked but idle.
  const stockPlan: { v: any; sp: any; qty: number }[] = [
    { v: marashBlue, sp: cascade, qty: 4 }, // fast → low cover
    { v: marashBlue, sp: megamall, qty: 6 },
    { v: marashRed, sp: cascade, qty: 9 },
    { v: ringM, sp: cascade, qty: 5 },
    { v: ringM, sp: megamall, qty: 7 },
    { v: ringL, sp: megamall, qty: 8 },
    { v: earTeal, sp: cascade, qty: 5 },
    { v: earTeal, sp: megamall, qty: 10 },
    { v: earRose, sp: megamall, qty: 12 }, // dead stock
  ];
  for (const s of stockPlan) {
    await prisma.stock.create({ data: { variantId: s.v.id, sellingPointId: s.sp.id, qtyOnHand: s.qty } });
  }

  // --- expenses (the leak side of the ledger) ---
  const expenseCats: [string, string, number][] = [
    ["rent", "Cascade kiosk", 120000],
    ["rent", "Megamall kiosk", 150000],
    ["wages", "Assistant", 180000],
    ["transport", "GG Taxi", 3200],
    ["packaging", "Tara Print", 18500],
    ["fees", "Card processor", 9400],
  ];
  for (let week = 0; week < 6; week++) {
    const date = new Date(today.getTime() - week * 7 * DAY);
    const [cat, vendor, amount] = pick(expenseCats);
    await prisma.expense.create({ data: { date, category: cat, vendor, amount, currency: "AMD" } });
    // monthly rent twice
    if (week % 4 === 0) {
      await prisma.expense.create({ data: { date, category: "rent", vendor: "Megamall kiosk", amount: 150000, currency: "AMD" } });
      await prisma.expense.create({ data: { date, category: "wages", vendor: "Assistant", amount: 180000, currency: "AMD" } });
    }
  }

  // --- one already-processed source image so the audit trail isn't empty ---
  await prisma.sourceImage.create({
    data: { url: "/uploads/.gitkeep", hash: "seed-demo-image", docType: "sales_sheet", status: "committed", note: "Seeded history", processedAt: new Date() },
  });

  const variants = await prisma.variant.count();
  console.log(`Seeded: ${points.length} selling points, ${variants} variants, ${saleCount} sales, expenses, BOM + materials.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
