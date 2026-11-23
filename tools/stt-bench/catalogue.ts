/**
 * Stage 0 STT bake-off helper (docs/voice-order/PLAN.md): talks to the LOCAL dev DB only.
 *
 *   npx tsx tools/stt-bench/catalogue.ts hotwords <warehouse name>          → JSON list of words
 *   npx tsx tools/stt-bench/catalogue.ts match <warehouse name> <file.json> [extra.json] → scores transcripts
 *
 * [extra.json]: variants missing in the local DB, added in memory only:
 * [{ "productName": "strapela", "attributes": [["Длина", "6"], ["Размер бруса", "17x4.5"]] }]
 *
 * <file.json>: [{ file, said, expected, runs: [{ model, hotwords, text, seconds }] }]
 * (written by bench.py). Scores each transcript with the stage 1 matcher.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@generated/client';
import { readFileSync, writeFileSync } from 'node:fs';
import {
  CatalogueVariant,
  MatchLine,
  buildIndex,
  matchPhrase,
  splitPhrases,
} from '../../src/order-assistant/engine/matcher';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

async function loadCatalogue(
  warehouseName: string,
): Promise<CatalogueVariant[]> {
  const warehouse = await prisma.warehouse.findFirstOrThrow({
    where: { name: { equals: warehouseName, mode: 'insensitive' } },
    select: { id: true, storeId: true },
  });
  const variants = await prisma.productVariant.findMany({
    where: {
      storeId: warehouse.storeId,
      warehouseId: warehouse.id,
      canSell: true,
      product: { isArchived: false },
    },
    select: {
      id: true,
      sku: true,
      barCode: true,
      price: true,
      product: {
        select: { id: true, name: true, brand: { select: { name: true } } },
      },
      inventory: {
        where: { warehouseId: warehouse.id },
        select: { quantity: true },
      },
      attributes: {
        select: {
          value: {
            select: {
              valueString: true,
              valueNumber: true,
              valueBool: true,
              attribute: { select: { name: true, nameUz: true, nameEn: true } },
            },
          },
        },
      },
    },
  });
  return variants.map((v) => ({
    variantId: v.id,
    productId: v.product.id,
    productName: v.product.name,
    brandName: v.product.brand?.name ?? null,
    sku: v.sku,
    barCode: v.barCode,
    price: v.price.toString(),
    stock: v.inventory.reduce((sum, i) => sum + i.quantity, 0),
    attributes: v.attributes.map(({ value }) => ({
      name: value.attribute.name,
      nameUz: value.attribute.nameUz,
      nameEn: value.attribute.nameEn,
      value:
        value.valueString ??
        value.valueNumber?.toString() ??
        (value.valueBool === null ? null : String(value.valueBool)),
    })),
  }));
}

/** Product names + text attribute values: what a seller says and Whisper does not know. */
function hotwords(catalogue: CatalogueVariant[]): string[] {
  const words = new Set<string>();
  for (const v of catalogue) {
    words.add(v.productName.trim());
    for (const a of v.attributes) {
      if (a.value && !/^[\d.,x×\s]+$/i.test(a.value)) words.add(a.value.trim());
    }
  }
  return [...words];
}

function label(v: CatalogueVariant | undefined): string {
  if (!v) return '—';
  const attrs = v.attributes
    .map((a) => a.value)
    .filter(Boolean)
    .join(' / ');
  return `${v.productName} ${attrs}`.trim();
}

interface Run {
  model: string;
  hotwords: boolean;
  text: string;
  seconds: number;
  ramMb?: number;
}
interface Sample {
  file: string;
  said: string;
  expected: string;
  runs: Run[];
}

function run(text: string, catalogue: CatalogueVariant[]): MatchLine[] {
  const index = buildIndex(catalogue);
  return splitPhrases(text, index).map((p) => matchPhrase(p, index, []));
}

/**
 * Reference per `;` part of `expected`, matched alone: a variant when it is MATCHED,
 * product only when the part names no variant (e.g. «metrovka» → AMBIGUOUS of one product).
 */
function reference(expected: string, catalogue: CatalogueVariant[]) {
  return expected.split(';').map((part) => {
    const [line] = run(part.trim(), catalogue);
    const top = line?.candidates[0];
    const oneProduct =
      line?.status === 'AMBIGUOUS' &&
      line.candidates.every((c) => c.productName === top?.productName);
    return {
      part: part.trim(),
      variantId: line?.status === 'MATCHED' ? top?.variantId : undefined,
      productName:
        line?.status === 'MATCHED' || oneProduct ? top?.productName : undefined,
    };
  });
}

interface ExtraVariant {
  productName: string;
  attributes: [string, string][];
}

function extraVariants(path: string | undefined): CatalogueVariant[] {
  if (!path) return [];
  const items = JSON.parse(readFileSync(path, 'utf8')) as ExtraVariant[];
  return items.map((x, i) => ({
    variantId: `extra-${i}`,
    productId: `extra-${x.productName}`,
    productName: x.productName,
    brandName: null,
    sku: `EXTRA-${i}`,
    barCode: null,
    price: '0',
    stock: 10,
    attributes: x.attributes.map(([name, value]) => ({
      name,
      nameUz: null,
      nameEn: null,
      value,
    })),
  }));
}

async function main() {
  const [mode, warehouseName, file, extra] = process.argv.slice(2);
  const catalogue = [
    ...(await loadCatalogue(warehouseName)),
    ...extraVariants(extra),
  ];
  const byId = new Map(catalogue.map((v) => [v.variantId, v]));

  if (mode === 'hotwords') {
    process.stdout.write(JSON.stringify(hotwords(catalogue)));
    return;
  }

  const samples = JSON.parse(readFileSync(file, 'utf8')) as Sample[];
  const out: string[] = [
    `# STT bake-off — warehouse ${warehouseName}, ${catalogue.length} variants`,
    '',
  ];
  const totals = new Map<
    string,
    { hit: number; product: number; all: number; sec: number; n: number }
  >();

  for (const s of samples) {
    const ref = reference(s.expected, catalogue);
    out.push(
      `## ${s.file}`,
      '',
      `- said: ${s.said}`,
      `- expected: ${s.expected}`,
    );
    out.push(
      `- reference: ${ref.map((r) => `${r.part} → ${r.variantId ? label(byId.get(r.variantId)) : r.productName ? `${r.productName} (any variant)` : '?? not found'}`).join('; ')}`,
      '',
    );

    const rows = [
      {
        model: 'human (said)',
        hotwords: false,
        text: s.said,
        seconds: 0,
      } as Run,
      ...s.runs,
    ];
    out.push(
      '| model | hw | sec | variant / product ok | transcript → top picks |',
      '|---|---|---|---|---|',
    );
    for (const r of rows) {
      const lines = run(r.text, catalogue);
      const tops = lines.map((l) => l.candidates[0]);
      // A product-only reference («metrovka») counts as a variant hit when the product is right.
      const variantHit = ref.filter((x) =>
        x.variantId
          ? tops.some((t) => t?.variantId === x.variantId)
          : x.productName && tops.some((t) => t?.productName === x.productName),
      ).length;
      const productHit = ref.filter(
        (x) =>
          x.productName && tops.some((t) => t?.productName === x.productName),
      ).length;
      const key = `${r.model}${r.hotwords ? ' +hw' : ''}`;
      const t = totals.get(key) ?? { hit: 0, product: 0, all: 0, sec: 0, n: 0 };
      t.hit += variantHit;
      t.product += productHit;
      t.all += ref.length;
      t.sec += r.seconds;
      t.n++;
      totals.set(key, t);
      const picks = lines
        .map(
          (l) =>
            `${l.status[0]}:${label(byId.get(l.candidates[0]?.variantId ?? ''))}`,
        )
        .join('; ');
      out.push(
        `| ${r.model} | ${r.hotwords ? 'yes' : ''} | ${r.seconds.toFixed(1)} | ${variantHit}/${ref.length} · ${productHit}/${ref.length} | «${r.text.replace(/\|/g, '/')}» → ${picks} |`,
      );
    }
    out.push('');
  }

  out.push(
    '## Totals',
    '',
    '| model | variant ok | product ok | avg sec / file |',
    '|---|---|---|---|',
  );
  for (const [k, t] of totals) {
    out.push(
      `| ${k} | ${t.hit}/${t.all} | ${t.product}/${t.all} | ${(t.sec / t.n).toFixed(1)} |`,
    );
  }
  const report = out.join('\n');
  writeFileSync(file.replace(/\.json$/, '.md'), report);
  process.stdout.write(report + '\n');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
