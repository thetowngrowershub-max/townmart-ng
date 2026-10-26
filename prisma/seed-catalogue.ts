/**
 * Demo catalogue seed: categories, six approved sellers with generated images,
 * their products (with variants and opening stock) and services (with weekly
 * availability). Listings go through the same validation and save functions as
 * the seller dashboard, so the demo data obeys every app rule.
 *
 * Demo promotions are added per store, relative to the time the seed runs,
 * so flash deals are live straight after seeding and end within two days.
 *
 * Idempotent: categories are upserted; a seller whose store already exists is
 * skipped, and so is a store that already has promotions.
 */
import { randomBytes } from "node:crypto";
import type { PrismaClient, Role } from "@prisma/client";
import sharp from "sharp";
import { hashPassword } from "../lib/auth/password";
import { saveProduct } from "../lib/catalogue/products";
import { saveService } from "../lib/catalogue/services";
import { encrypt, phoneHash } from "../lib/crypto";
import { dateToLagosLocal } from "../lib/datetime";
import { DPA_VERSION, SELLER_AGREEMENT_VERSION } from "../lib/legal";
import { normaliseNigerianPhone } from "../lib/phone";
import { savePromotion } from "../lib/promotions/promotions";
import { storage } from "../lib/storage";
import { productInputSchema, serviceInputSchema, type ProductInput, type ServiceInput } from "../lib/validation/catalogue";
import { promotionInputSchema, type PromotionInput } from "../lib/validation/promotions";
import { CATEGORIES, PROMOTIONS, SELLERS, type DemoProduct, type DemoSeller, type DemoService } from "./data/demo-catalogue";

const isProd = process.env.NODE_ENV === "production";

const escapeXml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);

/** Shifts a hex colour's lightness for a second gradient stop. */
function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (shift: number) => Math.max(0, Math.min(255, ((n >> shift) & 255) + amount));
  return `#${[16, 8, 0].map((s) => ch(s).toString(16).padStart(2, "0")).join("")}`;
}

/** A simple branded placeholder image: gradient, initials and caption. */
async function placeholder(opts: { title: string; caption: string; colour: string; width: number; height: number; variant: number }): Promise<Buffer> {
  const { width: w, height: h } = opts;
  const initials = opts.title
    .split(/\s+/)
    .filter((word) => /^[A-Za-z0-9]/.test(word))
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join("");
  const c2 = shade(opts.colour, opts.variant % 2 === 0 ? 60 : -40);
  const angle = (opts.variant * 47) % 360;
  const title = escapeXml(opts.title.length > 34 ? `${opts.title.slice(0, 33)}…` : opts.title);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs><linearGradient id="g" gradientTransform="rotate(${angle} .5 .5)"><stop offset="0" stop-color="${opts.colour}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>
  <rect width="100%" height="100%" fill="url(#g)"/>
  <circle cx="${w * 0.78}" cy="${h * 0.22}" r="${Math.min(w, h) * 0.28}" fill="#ffffff" fill-opacity="0.08"/>
  <circle cx="${w * 0.15}" cy="${h * 0.85}" r="${Math.min(w, h) * 0.2}" fill="#ffffff" fill-opacity="0.06"/>
  <text x="50%" y="${h * 0.5}" text-anchor="middle" font-family="Inter, DejaVu Sans, sans-serif" font-weight="800" font-size="${Math.min(w, h) * 0.3}" fill="#ffffff" fill-opacity="0.92">${escapeXml(initials)}</text>
  <text x="50%" y="${h * 0.72}" text-anchor="middle" font-family="Inter, DejaVu Sans, sans-serif" font-weight="600" font-size="${Math.min(w, h) * 0.055}" fill="#ffffff">${title}</text>
  <text x="50%" y="${h * 0.8}" text-anchor="middle" font-family="Inter, DejaVu Sans, sans-serif" font-size="${Math.min(w, h) * 0.04}" fill="#ffffff" fill-opacity="0.8">${escapeXml(opts.caption)}</text>
</svg>`;
  return sharp(Buffer.from(svg)).webp({ quality: 80 }).toBuffer();
}

async function putImage(key: string, body: Buffer) {
  await storage().putObject("public", key, body, "image/webp");
  return key;
}

function productInput(p: DemoProduct, images: ProductInput["images"]): ProductInput {
  const opts = [p.option, p.option2].filter((o): o is NonNullable<typeof o> => !!o);
  const base = p.title.toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 8);
  const combos: Record<string, string>[] = opts.reduce<Record<string, string>[]>((acc, o) => acc.flatMap((c) => o.values.map((v) => ({ ...c, [o.name]: v }))), [{}]);
  const variants = combos.map((ov) => {
    const i1 = p.option ? p.option.values.indexOf(ov[p.option.name]!) : -1;
    const price = (i1 >= 0 && p.option?.prices?.[i1]) || p.price;
    const stock = (i1 >= 0 && p.option?.stock?.[i1]) || p.stock;
    const suffix = opts.map((o) => (ov[o.name] ?? "").toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 6)).filter(Boolean);
    return {
      sku: [base, ...suffix].join("-"),
      optionValues: ov,
      price,
      // Compare-at only makes sense where it beats this variant's price.
      compareAtPrice: p.compareAt && Number(p.compareAt) > Number(price) ? p.compareAt : "",
      stockQty: stock,
      lowStockThreshold: p.threshold ?? "5",
    };
  });
  return {
    title: p.title,
    descriptionHtml: `<p>${p.description}</p>${p.perishable ? `<p><strong>Storage:</strong> ${p.perishable}</p>` : ""}`,
    categoryId: "",
    brand: p.brand,
    tags: p.tags,
    unit: p.unit ?? "piece",
    minOrderQty: p.fractional ? "0.5" : "1",
    allowFractionalQty: !!p.fractional,
    trackInventory: true,
    allowBackorder: false,
    weightGrams: p.weightGrams,
    isPerishable: !!p.perishable,
    shelfLifeNote: p.perishable,
    status: "active",
    options: opts.map((o) => ({ name: o.name, values: o.values.join(",") })),
    variants,
    images,
  };
}

function serviceInput(s: DemoService, lgaIds: number[], images: ServiceInput["images"]): ServiceInput {
  return {
    title: s.title,
    descriptionHtml: `<p>${s.description}</p>`,
    categoryId: "",
    pricingModel: s.pricing,
    basePrice: s.price,
    durationMinutes: s.duration,
    locationMode: s.location,
    serviceLgaIds: s.location === "at_provider" ? [] : lgaIds,
    radiusKm: s.radiusKm,
    depositPercent: s.deposit ?? 0,
    requiresConfirmation: s.confirm ?? true,
    status: "active",
    packages: (s.packages ?? []).map((p) => ({ name: p.name, description: p.description, price: p.price, durationMinutes: p.duration })),
    availability: s.hours.map(([weekday, start, end, slotMinutes, maxPerSlot]) => ({ weekday, start, end, slotMinutes, bufferMinutes: 15, maxPerSlot })),
    blackouts: [],
    images,
  };
}

export async function seedCategories(prisma: PrismaClient) {
  let n = 0;
  for (const [i, top] of CATEGORIES.entries()) {
    const parent = await prisma.category.upsert({
      where: { slug: top.slug },
      update: { name: top.name, kind: top.kind, icon: top.icon, sortOrder: i },
      create: { slug: top.slug, name: top.name, kind: top.kind, icon: top.icon, sortOrder: i },
    });
    for (const [j, c] of top.children.entries()) {
      await prisma.category.upsert({
        where: { slug: c.slug },
        update: { name: c.name, kind: top.kind, parentId: parent.id, sortOrder: j },
        create: { slug: c.slug, name: c.name, kind: top.kind, parentId: parent.id, sortOrder: j },
      });
      n++;
    }
  }
  console.log(`✓ ${CATEGORIES.length} categories and ${n} subcategories`);
}

async function seedSeller(prisma: PrismaClient, seller: DemoSeller, categoryIds: Map<string, string>) {
  const b = seller.business;
  if (await prisma.business.findUnique({ where: { slug: b.slug }, select: { id: true } })) {
    console.log(`• ${b.name} already exists`);
    return;
  }
  const phone = normaliseNigerianPhone(seller.owner.phone)!;
  const password = randomBytes(9).toString("base64url");
  const roles: Role[] = ["customer", ...(b.sellsProducts ? (["merchant"] as const) : []), ...(b.sellsServices ? (["service_provider"] as const) : [])];

  const state = await prisma.state.findUniqueOrThrow({ where: { name: b.state }, select: { id: true } });
  const lgaIdOf = async (name: string) => (await prisma.lga.findFirstOrThrow({ where: { stateId: state.id, name }, select: { id: true } })).id;
  const lgaId = await lgaIdOf(b.lga);
  const serviceLgaIds = await Promise.all((seller.serviceLgas ?? []).map(lgaIdOf));

  const owner = await prisma.user.upsert({
    where: { email: seller.owner.email },
    update: {},
    create: {
      email: seller.owner.email,
      name: seller.owner.name,
      passwordHash: await hashPassword(password),
      emailVerified: new Date(),
      phoneEncrypted: encrypt(phone),
      phoneHash: phoneHash(phone),
      phoneVerifiedAt: new Date(),
      roles: { create: roles.map((role) => ({ role })) },
    },
  });

  const now = new Date();
  // Approving a seller is privileged; the status guard trigger checks the RLS scope.
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_scope', 'system', true)`;
      const business = await tx.business.create({
        data: {
          ownerUserId: owner.id,
          type: b.type,
          name: b.name,
          slug: b.slug,
          description: b.description,
          cacNumber: b.cac ?? null,
          email: seller.owner.email,
          phoneEncrypted: encrypt(phone),
          phoneHash: phoneHash(phone),
          phoneVerifiedAt: now,
          addressEncrypted: encrypt(b.address),
          city: b.city,
          stateId: state.id,
          lgaId,
          status: "approved",
          submittedAt: now,
          reviewedAt: now,
          sellsProducts: b.sellsProducts,
          sellsServices: b.sellsServices,
          sellerAgreementVersion: SELLER_AGREEMENT_VERSION,
          sellerAgreementAcceptedAt: now,
          dpaVersion: DPA_VERSION,
          dpaAcceptedAt: now,
        },
      });
      const id = business.id;
      await tx.storePolicy.create({
        data: { businessId: id, returnWindowDays: b.returnWindowDays, deliveryOptions: { delivery: true, pickup: !!b.pickup, notes: "" }, pickupAddressEncrypted: b.pickup ? encrypt(b.address) : null, acceptsPayOnDelivery: !!b.payOnDelivery },
      });
      await tx.businessKyc.create({ data: { businessId: id, provider: "manual", verificationStatus: "verified", idDocumentType: b.cac ? "cac_certificate" : "nin_slip", verifiedAt: now, notes: "Demo seller (seed data)" } });
      await tx.payoutAccount.create({
        data: { businessId: id, bankCode: "058", bankName: "Guaranty Trust Bank", accountNumberLast4: seller.owner.phone.slice(-4), accountName: b.name.toUpperCase(), providerSubaccountCode: `ACCT_demo_${b.slug}`, verifiedAt: now },
      });

      const logoKey = await putImage(`logos/${id}/seed-logo.webp`, await placeholder({ title: b.name, caption: "", colour: b.colour, width: 512, height: 512, variant: 0 }));
      const bannerKey = await putImage(`banners/${id}/seed-banner.webp`, await placeholder({ title: b.name, caption: `${b.city}, ${b.state}`, colour: b.colour, width: 2400, height: 800, variant: 1 }));
      await tx.business.update({ where: { id }, data: { logoKey, bannerKey } });

      for (const [n, p] of seller.products.entries()) {
        const count = p.images ?? 1;
        const images: ProductInput["images"] = [];
        for (let k = 0; k < count; k++) {
          const key = await putImage(`products/${id}/seed-${n}-${k}.webp`, await placeholder({ title: p.title, caption: b.name, colour: b.colour, width: 1200, height: 1200, variant: n + k }));
          images.push({ key, altText: k === 0 ? p.title : `${p.title}, view ${k + 1}`, width: 1200, height: 1200, isCover: k === 0 });
        }
        const input = { ...productInput(p, images), categoryId: categoryIds.get(p.category) ?? "" };
        const data = productInputSchema.parse(input);
        await saveProduct(tx, { businessId: id, actorUserId: owner.id, data, stockSource: { reason: "manual_adjustment", note: "Opening stock (demo data)" } });
      }

      for (const [n, s] of seller.services.entries()) {
        const images: ServiceInput["images"] = [];
        for (let k = 0; k < 2; k++) {
          const key = await putImage(`services/${id}/seed-${n}-${k}.webp`, await placeholder({ title: s.title, caption: b.name, colour: b.colour, width: 1200, height: 900, variant: n + k }));
          images.push({ key, altText: k === 0 ? s.title : `${s.title}: past work`, width: 1200, height: 900 });
        }
        const input = { ...serviceInput(s, serviceLgaIds.length ? serviceLgaIds : [lgaId], images), categoryId: categoryIds.get(s.category) ?? "" };
        await saveService(tx, { businessId: id, data: serviceInputSchema.parse(input) });
      }
    },
    { timeout: 180_000 },
  );

  const what = [seller.products.length && `${seller.products.length} products`, seller.services.length && `${seller.services.length} services`].filter(Boolean).join(", ");
  if (isProd) console.log(`✓ ${b.name}: ${what}`);
  else console.log(`✓ ${b.name}: ${what}. Owner ${seller.owner.email} / password: ${password}   (dev only)`);
}

export async function seedDemoCatalogue(prisma: PrismaClient) {
  await seedCategories(prisma);
  if (isProd && process.env.SEED_DEMO_DATA !== "true") {
    console.log("• Demo sellers skipped in production (set SEED_DEMO_DATA=true to include them)");
    return;
  }
  const categoryIds = new Map((await prisma.category.findMany({ select: { slug: true, id: true } })).map((c) => [c.slug, c.id]));
  for (const seller of SELLERS) await seedSeller(prisma, seller, categoryIds);
  await seedDemoPromotions(prisma, categoryIds);
}

async function seedDemoPromotions(prisma: PrismaClient, categoryIds: Map<string, string>) {
  const hour = 3_600_000;
  const start = new Date(Math.floor(Date.now() / hour) * hour);
  for (const [slug, promos] of Object.entries(PROMOTIONS)) {
    const business = await prisma.business.findUnique({ where: { slug }, select: { id: true, name: true, ownerUserId: true, _count: { select: { promotions: true } } } });
    if (!business || business._count.promotions > 0) continue;
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_scope', 'system', true)`;
      const listingIds = async (model: "product" | "service", titles: string[] = []) => {
        const rows =
          model === "product"
            ? await tx.product.findMany({ where: { businessId: business.id, title: { in: titles } }, select: { id: true } })
            : await tx.service.findMany({ where: { businessId: business.id, title: { in: titles } }, select: { id: true } });
        if (rows.length !== titles.length) throw new Error(`Demo promotion for ${slug} names a listing that doesn't exist`);
        return rows.map((r) => r.id);
      };
      for (const p of promos) {
        const input: PromotionInput = {
          name: p.name,
          description: p.description ?? "",
          discountType: p.type,
          discountValue: p.value,
          scope: p.scope,
          productIds: await listingIds("product", p.products),
          serviceIds: await listingIds("service", p.services),
          categoryIds: (p.categories ?? []).map((c) => categoryIds.get(c) ?? ""),
          startsAt: dateToLagosLocal(start),
          endsAt: dateToLagosLocal(new Date(start.getTime() + p.hours * hour)),
          usageLimit: p.usageLimit ?? "",
          perCustomerLimit: p.perCustomerLimit ?? "",
          minOrder: p.minOrder ?? "",
          isFlashDeal: !!p.flash,
          isActive: true,
          couponCode: p.coupon ?? "",
          allowsStacking: false,
        };
        await savePromotion(tx, { businessId: business.id, actorUserId: business.ownerUserId, data: promotionInputSchema.parse(input) });
      }
    });
    console.log(`✓ ${business.name}: ${promos.length} promotion${promos.length === 1 ? "" : "s"}`);
  }
}

