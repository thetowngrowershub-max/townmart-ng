/**
 * Phase 7 reference data and content: category attributes, the prohibited-
 * items keyword list, help centre answers and the about and contact pages
 * (always), plus homepage banners, featured stores, a few attribute values,
 * questions and a report on demo listings (demo data only). Idempotent.
 */
import type { PrismaClient } from "@prisma/client";
import { KEYWORDS_SETTING, DEFAULT_KEYWORDS } from "../lib/moderation/keywords";
import { sanitizeCmsHtml } from "../lib/sanitize";

const ATTRIBUTES = [
  { slug: "condition", name: "Condition", type: "select", options: ["Brand new", "UK used", "Nigerian used", "Refurbished"] },
  { slug: "warranty", name: "Warranty", type: "select", options: ["None", "3 months", "6 months", "1 year", "2 years"] },
  { slug: "screen_size_in", name: "Screen size (inches)", type: "number", options: [] },
  { slug: "material", name: "Material", type: "text", options: [] },
  { slug: "origin", name: "Where it's from", type: "text", options: [] },
] as const;

/** Category slug → attributes in order; [slug, required]. */
const CATEGORY_ATTRIBUTES: Record<string, [string, boolean][]> = {
  electronics: [
    ["condition", true],
    ["warranty", false],
  ],
  "phones-tablets": [["screen_size_in", false]],
  computers: [["screen_size_in", false]],
  fashion: [["material", false]],
  "farm-produce": [["origin", false]],
};

const FAQ: { section: string; question: string; answer: string }[] = [
  { section: "Buying", question: "How do I know a seller is genuine?", answer: "<p>Every store is checked by TownMart before it can sell: we confirm the owner's identity, the business address and the bank account payouts go to. Reviews come only from customers who bought.</p>" },
  { section: "Buying", question: "Can I pay on delivery?", answer: "<p>Some sellers accept payment on delivery for orders in their area. You'll see the option at checkout when every seller in your cart offers it.</p>" },
  { section: "Buying", question: "Is my payment safe?", answer: "<p>Yes. You pay TownMart through Paystack or Flutterwave. We hold the money and pay the seller only after your order is delivered and the return window has passed.</p>" },
  { section: "Delivery", question: "How much is delivery?", answer: "<p>Each seller's delivery fee depends on where you are and how heavy the parcel is. You see the full price, delivery included, before you pay.</p>" },
  { section: "Delivery", question: "Can I collect my order?", answer: "<p>Many stores offer pickup. Choose it at checkout and the seller will tell you when it's ready.</p>" },
  { section: "Refunds and returns", question: "How do I ask for a refund?", answer: '<p>Open the order from <a href="/account/orders">your orders</a> and choose <strong>Ask for a refund</strong>. The seller has 48 hours to reply; if they don\'t, or you can\'t agree, TownMart decides.</p>' },
  { section: "Refunds and returns", question: "How long do refunds take?", answer: "<p>Once a refund is approved we send it straight away. Card refunds usually reach you in 3 to 10 working days; bank transfers are often faster.</p>" },
  { section: "Bookings", question: "Can I cancel a booking?", answer: "<p>Yes, from <a href=\"/account/bookings\">your bookings</a>. Cancel more than 24 hours before and you get a full refund; later than that, part of the price may be kept.</p>" },
  { section: "Selling", question: "How do I start selling?", answer: '<p>Go to <a href="/sell">Sell on TownMart</a>, tell us about your business and upload your documents. We usually review applications within two working days.</p>' },
  { section: "Selling", question: "When do I get paid?", answer: "<p>Earnings become available a few days after an order is completed. TownMart pays available balances to your verified bank account on a regular schedule, and you can ask for a payout at any time.</p>" },
];

const PAGES = [
  {
    slug: "about",
    title: "About TownMart",
    summary: "A marketplace for the shops, farms and artisans in your town.",
    body: `<p>TownMart brings together the stores, farms and skilled people you already trust, so you can buy groceries, fashion and electronics, or book a plumber or tailor, in one place.</p>
<h2>What we stand for</h2>
<ul><li><strong>Verified sellers.</strong> Every store is checked before it can sell.</li><li><strong>Honest prices.</strong> You see the full price, delivery included, before you pay. Discounts show their real end date.</li><li><strong>Protected payments.</strong> Sellers are paid after your order arrives.</li></ul>
<p>Want to sell with us? <a href="/sell">Open your store</a>.</p>`,
  },
  {
    slug: "contact",
    title: "Contact us",
    summary: "We usually reply within one working day.",
    body: `<p>For help with an order or booking, start from <a href="/account/orders">your orders</a>: the seller sees your message straight away, and you can ask TownMart to step in.</p>
<h2>Write to us</h2>
<ul><li>Customer support: <a href="mailto:support@townmart.ng">support@townmart.ng</a></li><li>Sellers: <a href="mailto:sellers@townmart.ng">sellers@townmart.ng</a></li><li>Privacy and data requests: <a href="/legal/data-request">make a request</a></li></ul>
<p>Our team works Monday to Saturday, 8am to 6pm (Lagos time).</p>`,
  },
];

export async function seedContent(prisma: PrismaClient) {
  await prisma.setting.upsert({
    where: { key: KEYWORDS_SETTING },
    update: {},
    create: { key: KEYWORDS_SETTING, value: [...DEFAULT_KEYWORDS], description: "Words and phrases that flag a listing for review" },
  });

  for (const a of ATTRIBUTES) {
    await prisma.attribute.upsert({ where: { slug: a.slug }, update: {}, create: { slug: a.slug, name: a.name, type: a.type, options: [...a.options] } });
  }
  const attrIds = new Map((await prisma.attribute.findMany({ select: { id: true, slug: true } })).map((a) => [a.slug, a.id]));
  for (const [categorySlug, attrs] of Object.entries(CATEGORY_ATTRIBUTES)) {
    const category = await prisma.category.findUnique({ where: { slug: categorySlug }, select: { id: true } });
    if (!category) continue;
    for (const [i, [slug, isRequired]] of attrs.entries()) {
      await prisma.categoryAttribute.upsert({
        where: { categoryId_attributeId: { categoryId: category.id, attributeId: attrIds.get(slug)! } },
        update: {},
        create: { categoryId: category.id, attributeId: attrIds.get(slug)!, isRequired, sortOrder: i },
      });
    }
  }

  if ((await prisma.faqEntry.count()) === 0) {
    await prisma.faqEntry.createMany({ data: FAQ.map((f, i) => ({ section: f.section, question: f.question, answerHtml: sanitizeCmsHtml(f.answer), sortOrder: i })) });
  }
  for (const p of PAGES) {
    await prisma.cmsPage.upsert({ where: { slug: p.slug }, update: {}, create: { slug: p.slug, title: p.title, summary: p.summary, bodyHtml: sanitizeCmsHtml(p.body) } });
  }
  console.log(`✓ ${ATTRIBUTES.length} attributes, keyword list, ${FAQ.length} help answers, about and contact pages`);
}

/** Demo-only: banners, featured stores, attribute values, questions and a report. */
export async function seedDemoContent(prisma: PrismaClient) {
  if ((await prisma.cmsBanner.count()) === 0) {
    await prisma.cmsBanner.createMany({
      data: [
        { title: "Fresh from the farm, delivered", subtitle: "Yams, tomatoes and eggs from Ogun Harvest Farms.", linkUrl: "/c/farm-produce", ctaLabel: "Shop farm produce", sortOrder: 0 },
        { title: "Need a plumber this week?", subtitle: "Book a verified tradesperson near you and pay after the job.", linkUrl: "/c/services", ctaLabel: "Book a service", sortOrder: 1 },
      ],
    });
  }
  if ((await prisma.featuredStore.count()) === 0) {
    const stores = await prisma.business.findMany({ where: { slug: { in: ["ikeja-fresh-mart", "cv-gadget-hub", "mama-titi-couture"] }, status: "approved" }, select: { id: true, slug: true } });
    const order = ["ikeja-fresh-mart", "cv-gadget-hub", "mama-titi-couture"];
    await prisma.featuredStore.createMany({ data: stores.sort((a, b) => order.indexOf(a.slug) - order.indexOf(b.slug)).map((s, i) => ({ businessId: s.id, sortOrder: i })) });
  }

  const gadgets = await prisma.business.findUnique({ where: { slug: "cv-gadget-hub" }, select: { id: true, ownerUserId: true } });
  const shopper = await prisma.user.findUnique({ where: { email: "bola@demo.townmart.ng" }, select: { id: true, name: true } });
  if (!gadgets) return;
  const product = (title: string) => prisma.product.findFirst({ where: { businessId: gadgets.id, title }, select: { id: true, attributes: true } });
  const values: [string, Record<string, string | number>][] = [
    ["Samsung Galaxy A15", { condition: "Brand new", warranty: "1 year", screen_size_in: 6.5 }],
    ["Tecno Spark 20", { condition: "Brand new", warranty: "1 year", screen_size_in: 6.6 }],
    ["iPhone 13, 128 GB (UK used)", { condition: "UK used", warranty: "6 months", screen_size_in: 6.1 }],
    ["HP 250 G9 Laptop", { condition: "Brand new", warranty: "1 year", screen_size_in: 15.6 }],
  ];
  for (const [title, attributes] of values) {
    const p = await product(title);
    if (p && Object.keys((p.attributes ?? {}) as object).length === 0) await prisma.product.update({ where: { id: p.id }, data: { attributes } });
  }

  const samsung = await product("Samsung Galaxy A15");
  if (samsung && shopper && (await prisma.listingQuestion.count({ where: { productId: samsung.id } })) === 0) {
    await prisma.listingQuestion.createMany({
      data: [
        { productId: samsung.id, businessId: gadgets.id, askerUserId: shopper.id, askerName: "Bola A.", question: "Does it come with a charger in the box?", answer: "Yes. The box has a 25 W USB-C charger and cable.", answeredBy: gadgets.ownerUserId, answeredAt: new Date() },
        { productId: samsung.id, businessId: gadgets.id, askerUserId: shopper.id, askerName: "Bola A.", question: "Can I pick it up in Computer Village on Saturday?" },
      ],
    });
  }
  const iphone = await product("iPhone 13, 128 GB (UK used)");
  if (iphone && shopper && (await prisma.listingReport.count({ where: { productId: iphone.id } })) === 0) {
    await prisma.listingReport.create({ data: { productId: iphone.id, businessId: gadgets.id, reporterUserId: shopper.id, reason: "misleading", details: "Says UK used but the photos look like a different phone." } });
  }
  console.log("✓ demo banners, featured stores, attribute values, questions and a report");
}
