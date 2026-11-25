/**
 * First versions of TownMart's legal pages, seeded into `legal_documents`.
 * They are templates: plain-English starting points to be reviewed by a
 * Nigerian lawyer and the DPO before launch, then edited and republished from
 * the compliance centre. {{company.*}} and {{retention.*}} placeholders are
 * filled in from settings when a page is shown.
 */

export const INITIAL_LEGAL_VERSION = "2026-10-draft";

type Section = { heading: string; body: (string | string[])[] };
export type LegalTemplate = { slug: string; title: string; summary: string; sections: Section[] };

export const LEGAL_TEMPLATES: LegalTemplate[] = [
  {
    slug: "privacy",
    title: "Privacy Policy",
    summary: "What personal data TownMart collects, why, who it is shared with, how long it is kept and your rights under the Nigeria Data Protection Act 2023.",
    sections: [
      {
        heading: "1. Who we are",
        body: [
          "TownMart is run by {{company.legal_name}} (RC {{company.rc_number}}), {{company.address}}. We are the data controller for the personal data described here.",
          "Our Data Protection Officer is {{company.dpo_name}}. You can reach them at {{company.dpo_email}} about anything in this policy.",
        ],
      },
      {
        heading: "2. What we collect",
        body: [
          [
            "Shoppers: name, email, phone number, delivery addresses, orders and bookings, messages with sellers, reviews, refund requests and the photos you send with them.",
            "Sellers and service providers: business and owner details, business phone and address, verification documents and the reference from identity checks (never your raw BVN or NIN), bank account name and last four digits.",
            "TownMart staff: account details and a record of what they do in the admin console.",
            "Everyone who visits: a hashed (pseudonymised) IP address, browser type, the pages you use and your cookie choices.",
          ],
          "We never see or store full card details; our payment partners handle them.",
        ],
      },
      {
        heading: "3. Why we use it, and our lawful basis",
        body: [
          [
            "To create your account, take orders and bookings, deliver them and handle returns: performance of a contract with you.",
            "To pay sellers, keep accounting records and meet tax and anti-fraud duties: legal obligation.",
            "To keep TownMart secure, prevent fraud and improve the service: our legitimate interests, balanced against your rights.",
            "To send marketing emails or SMS and to use analytics or marketing cookies: your consent, which you can withdraw at any time.",
          ],
        ],
      },
      {
        heading: "4. Who we share it with",
        body: [
          [
            "The seller you buy from or book with receives only your name, phone number and, where they deliver or come to you, your address. Your phone number is hidden from them 30 days after the order is completed.",
            "Payment providers (Paystack, Flutterwave) to take payments, refunds and payouts.",
            "Delivery partners chosen by the seller, for delivery.",
            "Email and SMS providers, to send receipts, updates and sign-in codes.",
            "Our hosting and security providers, who store and protect the service.",
            "Authorities, where the law requires it.",
          ],
          "The full list of the companies that process data for us is kept in our record of processors and is available from the DPO.",
        ],
      },
      {
        heading: "5. Where your data is stored",
        body: [
          "Our database is hosted in {{company.hosting_location}}. Where a provider processes data outside Nigeria, we rely on the safeguards allowed by the NDPA, such as an adequacy decision, standard contractual clauses or your consent, and we record each transfer.",
        ],
      },
      {
        heading: "6. How long we keep it",
        body: [
          [
            "Order, payment and refund records: six years, as tax and accounting law requires, even after you delete your account.",
            "Abandoned shopping carts: {{retention.abandoned_carts}} days.",
            "Accounts never confirmed by email: {{retention.unverified_accounts}} days.",
            "Technical logs and in-app notifications: {{retention.logs}} days.",
            "Deleted accounts: anonymised {{retention.deletion_grace}} days after you ask, once the grace period ends.",
          ],
        ],
      },
      {
        heading: "7. Your rights",
        body: [
          "You can ask to see your data, get a copy in a machine-readable format, correct it, delete it, restrict or object to how we use it, and withdraw consent. Signed-in users can do most of this from the Privacy Centre in their account; anyone can use the data request form at /legal/data-request.",
          "We answer within {{retention.dsr_response}} days. If you are not happy with our answer you can complain to the Nigeria Data Protection Commission (NDPC).",
        ],
      },
      {
        heading: "8. Cookies",
        body: ["Necessary cookies keep you signed in and your cart working. Functional, analytics and marketing cookies are only set if you allow them. See our Cookie Policy, and change your choice at any time from \"Cookie settings\" in the footer."],
      },
      {
        heading: "9. Children",
        body: ["TownMart is for people aged 18 and over. Under-18s may only use it with the consent of a parent or guardian. If we learn we hold a child's data without that consent we will delete it."],
      },
      {
        heading: "10. Security",
        body: ["Phone numbers, addresses and identity-check references are encrypted in our database, connections are encrypted, access is limited to staff who need it and logged, and we keep a breach register. If a breach puts your rights at high risk we will tell you and the NDPC within 72 hours of becoming aware of it."],
      },
      {
        heading: "11. Changes to this policy",
        body: ["Each version is dated and kept. We tell you about important changes by email or a notice on the site before they take effect."],
      },
    ],
  },
  {
    slug: "cookies",
    title: "Cookie Policy",
    summary: "The cookies TownMart uses and how to choose which ones you allow.",
    sections: [
      { heading: "1. What cookies are", body: ["Cookies are small files a website stores in your browser. We also use similar browser storage; this policy covers both."] },
      {
        heading: "2. The kinds we use",
        body: [
          [
            "Necessary (always on): keep you signed in, protect forms from abuse, remember your cart and your cookie choice. The site can't work without them.",
            "Functional: remember preferences such as recently viewed items.",
            "Analytics: tell us, in aggregate, how the site is used so we can improve it.",
            "Marketing: measure and personalise our adverts on other sites.",
          ],
        ],
      },
      { heading: "3. Your choice", body: ["When you first visit we ask which optional cookies you allow, with equally easy buttons to accept all, reject all optional cookies, or choose. No analytics or marketing scripts run until you say yes. Change your choice at any time from \"Cookie settings\" in the footer; we keep a record of each choice."] },
      { heading: "4. How long they last", body: ["Your cookie choice is remembered for 12 months, then we ask again. Sign-in cookies last until you sign out or for up to 30 days."] },
    ],
  },
  {
    slug: "terms",
    title: "Terms of Use",
    summary: "The rules for using TownMart and buying from sellers on it.",
    sections: [
      { heading: "1. About TownMart", body: ["TownMart is an online marketplace in Nigeria run by {{company.legal_name}}. Independent sellers list products and services; TownMart runs the platform, takes payments on their behalf and helps resolve problems. When you buy, your contract for the item is with the seller."] },
      { heading: "2. Your account", body: ["You can buy as a guest or with an account. Keep your sign-in details private and tell us straight away if you think someone else has used your account. You must be 18 or over, or have a parent's or guardian's permission, to place an order."] },
      { heading: "3. Prices and fees", body: ["Prices are in naira and include any discounts shown. At checkout we show, before you pay, the item total, discounts, delivery fees for each seller, TownMart's service fee and VAT on that fee. The total you see is the total you pay.", "If a price or fee changes while you are checking out, we tell you the new total and ask you to confirm it before taking payment."] },
      { heading: "4. Payment", body: ["Online payments are processed by our payment partners (Paystack or Flutterwave). TownMart never sees or stores your full card details. Where a seller offers pay on delivery, you pay the rider or seller when the order arrives.", "Items are held for you for a short time while you pay. If payment doesn't arrive in that time the order is cancelled and the items go back on sale. If you are charged for an order that was cancelled, we refund you in full."] },
      { heading: "5. Delivery and pickup", body: ["Each seller delivers or offers pickup separately, so one checkout may arrive in several parcels. Delivery times are estimates in working days and depend on your location. See our Shipping & Delivery Policy."] },
      { heading: "6. Returns and refunds", body: ["Our Refund Policy explains when and how you can return an item or get your money back. It does not limit your rights under the Federal Competition and Consumer Protection Act 2018."] },
      { heading: "7. Using TownMart fairly", body: ["Follow our Acceptable Use Policy: no fraud, fake orders or reviews, scraping, or attempts to get around our security. We may cancel orders or close accounts that do."] },
      { heading: "8. Your data", body: ["We handle your personal data as our Privacy Policy explains, in line with the Nigeria Data Protection Act 2023. Sellers receive only what they need to fulfil your order."] },
      { heading: "9. Changes", body: ["We may update these terms. The version you accepted is recorded with each order and applies to that order."] },
    ],
  },
  {
    slug: "seller-agreement",
    title: "Seller Agreement",
    summary: "The terms for selling products or services on TownMart.",
    sections: [
      { heading: "1. Who this is between", body: ["This agreement is between you (the seller) and {{company.legal_name}}, the operator of the TownMart marketplace in Nigeria. By accepting it during onboarding you confirm you can bind your business."] },
      { heading: "2. Your listings", body: ["You must own or be allowed to sell what you list, describe it accurately, keep prices and stock up to date, and follow our Prohibited Items policy.", "You are responsible for the quality, safety and legality of your products and services, including any licences your trade needs."] },
      { heading: "3. Orders, payments and payouts", body: ["Customers pay TownMart through our payment provider. We hold the payment until the order is delivered or the service is completed, then pay you, minus our commission and any refunds, to your verified bank account.", "Commission rates are shown in your dashboard before they apply. We give at least 14 days' notice of increases."] },
      { heading: "4. Fulfilment and returns", body: ["You must fulfil orders within the time you advertise and honour the return window you set, as well as customers' rights under the Federal Competition and Consumer Protection Act 2018."] },
      { heading: "5. Customer data", body: ["You receive customer names, phone numbers and addresses only to fulfil orders and bookings. You process them under the Data Processing Agreement and must not use them for marketing without the customer's consent."] },
      { heading: "6. Verification and suspension", body: ["We verify your identity and bank account before approval. We may suspend or remove listings or your store for breaches of this agreement, fraud, or repeated customer complaints, and will tell you why."] },
      { heading: "7. Changes", body: ["We may update this agreement. Material changes are announced in your dashboard and by email, and you will be asked to accept the new version."] },
    ],
  },
  {
    slug: "service-provider-terms",
    title: "Service Provider & Artisan Terms",
    summary: "Extra terms for businesses that offer bookable services on TownMart, on top of the Seller Agreement.",
    sections: [
      { heading: "1. Your services", body: ["Describe each service honestly: what is included, how long it takes, where it happens and the full price, including any balance paid on the day. Hold any licence or qualification your trade needs."] },
      { heading: "2. Availability and bookings", body: ["Keep your weekly hours and time off up to date. TownMart only offers times you are available, and a confirmed booking is a promise to turn up on time."] },
      { heading: "3. Cancellations", body: [["If the customer cancels 24 hours or more before the start, they get a full refund.", "If they cancel later, they get the partial refund shown on the booking, or none if the service says so.", "If you cancel or don't turn up, the customer gets a full refund, and repeated no-shows can lead to suspension."]] },
      { heading: "4. Safety and conduct", body: ["Treat customers and their homes with respect, carry ID when you visit, and never ask for payment outside TownMart for a booked service, apart from a balance shown on the booking."] },
      { heading: "5. Customer data", body: ["Customer addresses and phone numbers are shared only so you can perform the booking. The Data Processing Agreement applies to them."] },
    ],
  },
  {
    slug: "refunds",
    title: "Refund & Returns Policy",
    summary: "When you can return an item, cancel an order or booking, or get your money back.",
    sections: [
      { heading: "1. Before it ships", body: ["You can ask to cancel an order until the seller marks it as shipped or ready for pickup. Paid orders cancelled this way are refunded in full, including delivery and the service fee."] },
      { heading: "2. Returns", body: ["You can return goods within 7 days of delivery, or the longer window the seller shows on the product page and at checkout. Items must be unused and in their original packaging, unless they arrived damaged, faulty or not as described."] },
      { heading: "3. Perishable goods", body: ["Fresh food and other perishables can only be returned if they arrive spoiled or not as described, and you must report it with photos within 24 hours of delivery."] },
      { heading: "4. Items that can't be returned", body: [["Opened underwear, swimwear, cosmetics and personal-care items, for hygiene reasons.", "Items made or altered to your order.", "Digital codes and gift cards once revealed.", "Perishables, except as described above."]] },
      { heading: "5. Damaged, faulty or wrong items", body: ["If an item arrives damaged, faulty or isn't what you ordered, report it with photos within the return window. You get a full refund or replacement, including the cost of returning it."] },
      { heading: "6. Services", body: [["Cancel 24 hours or more before the start: full refund.", "Cancel later: the partial refund shown on the booking, or none if the service says so.", "The provider cancels or doesn't turn up: full refund."]] },
      { heading: "7. How refunds are paid", body: ["Refunds go back to the way you paid: to your card or bank account for online payments, or by bank transfer for pay on delivery. We start the refund within 48 hours of approving it; your bank may take up to 10 working days to show it.", "If you used a coupon or promotion, you get back what you actually paid for the item."] },
      { heading: "8. Payments we can't match", body: ["If you are charged twice, or pay after an order has been cancelled and the item is no longer available, we refund the payment in full."] },
      { heading: "9. If you can't agree", body: ["Raise it with the seller from your order page first. If you can't agree, TownMart reviews the case and decides. We hold the seller's payment until the order is delivered and the return window has passed, so refunds we approve are paid. If you are still unhappy you can complain to the Federal Competition and Consumer Protection Commission (FCCPC)."] },
      { heading: "10. Your legal rights", body: ["This policy adds to, and does not reduce, your rights under the Federal Competition and Consumer Protection Act 2018."] },
    ],
  },
  {
    slug: "shipping",
    title: "Shipping & Delivery Policy",
    summary: "How delivery and pickup work when you buy from sellers on TownMart.",
    sections: [
      { heading: "1. Who delivers", body: ["Each seller delivers their own items, or uses a delivery partner, or offers pickup. If you buy from several sellers, each part arrives separately."] },
      { heading: "2. Fees and times", body: ["Delivery fees and estimated times depend on the seller and your state and LGA. They are shown for each seller before you pay. Times are in working days and are estimates, not guarantees."] },
      { heading: "3. Tracking", body: ["You can follow each part of your order from your order page. Sellers add tracking details when they have them, and you get an email and SMS when your items are sent or ready to collect."] },
      { heading: "4. Pickup", body: ["For pickup orders, the seller tells you when your items are ready and where to collect them. Bring your order number."] },
      { heading: "5. Problems", body: ["If your order is late, lost or arrives damaged, tell the seller from your order page. If it isn't sorted out, our Refund Policy applies."] },
    ],
  },
  {
    slug: "promotions",
    title: "Promotions & Coupon Terms",
    summary: "How discounts, flash deals and coupon codes work on TownMart, for shoppers and sellers.",
    sections: [
      { heading: "1. Who runs a promotion", body: ["Most promotions are run by the seller named on the listing, who pays for the discount. TownMart may also run platform-wide promotions, which say so.", "The seller sets the discount, what it covers, when it starts and ends (Lagos time), and any limits. TownMart may end a promotion that breaks these terms."] },
      { heading: "2. Honest prices", body: ["A discounted price must be a real reduction from the price the item normally sells for on TownMart. Sellers must not raise a price just before a promotion to make the discount look bigger.", "Every promotion shows its real end date and time. TownMart does not show fake countdowns or fake stock warnings.", "Flash deals last no more than 72 hours."] },
      { heading: "3. How discounts are worked out", body: ["Each item gets the single best discount it qualifies for. A coupon code replaces that discount if the coupon is better, unless the seller allows the code to be combined, in which case it is taken off the already-discounted price.", "Prices never go below ₦0. Discounts are rounded to the nearest kobo. Delivery fees are not discounted unless the promotion says so.", "A minimum order means the value of that seller's items in your cart, before discounts."] },
      { heading: "4. Coupon codes", body: ["A code works only for the promotion it belongs to, during its dates, and up to any total or per-customer limit. Codes have no cash value and can't be exchanged or transferred for payment.", "We may refuse or reverse a discount obtained by fraud, by abusing limits (for example with several accounts), or because of an obvious pricing error, and will tell you why."] },
      { heading: "5. Refunds and returns", body: ["If you return a discounted item, you are refunded what you actually paid for it. If returning part of an order means you no longer meet a minimum order, the refund is reduced by the discount that no longer applies.", "Your rights under the Federal Competition and Consumer Protection Act 2018 are not affected by any promotion."] },
      { heading: "6. Changes and ending early", body: ["A seller may pause or end a promotion early. Orders already placed keep the price shown at checkout."] },
    ],
  },
  {
    slug: "prohibited-items",
    title: "Prohibited Items",
    summary: "What can't be sold or offered on TownMart.",
    sections: [
      {
        heading: "Not allowed",
        body: [
          [
            "Weapons, ammunition and explosives; illegal drugs and drug paraphernalia; prescription-only medicines and unregistered drugs or cosmetics (NAFDAC registration required where applicable).",
            "Counterfeit or stolen goods; items that infringe trademarks or copyright; government IDs, documents or uniforms.",
            "Live wild animals and protected species or their parts; human remains or organs.",
            "Adult content and services; gambling; financial products that need a licence you don't hold.",
            "Hazardous chemicals and anything banned from sale by Nigerian law or the Nigeria Customs Service import prohibition list.",
          ],
        ],
      },
      { heading: "Enforcement", body: ["Listings that break this policy are removed. Repeated or serious breaches lead to suspension and may be reported to the authorities."] },
    ],
  },
  {
    slug: "dpa",
    title: "Data Processing Agreement",
    summary: "How sellers and other processors must handle personal data they receive through TownMart, under the Nigeria Data Protection Act 2023.",
    sections: [
      { heading: "1. Roles", body: ["For order fulfilment, {{company.legal_name}} (TownMart) is the data controller and you process customer personal data on our behalf and only on our documented instructions. The same terms apply to service companies that process data for TownMart, alongside their own contract with us."] },
      { heading: "2. What you may do", body: ["Use customer details only to deliver orders, perform booked services, and handle returns and complaints for those orders."] },
      { heading: "3. Security", body: ["Keep customer data confidential, limit access to staff who need it, and protect it with appropriate technical and organisational measures."] },
      { heading: "4. Breaches", body: ["Tell TownMart at {{company.dpo_email}} without undue delay, and within 24 hours, if you become aware of a personal data breach involving TownMart customers, so we can meet our 72-hour duty to notify the Nigeria Data Protection Commission."] },
      { heading: "5. Retention and deletion", body: ["Delete or return customer data when you no longer need it for the order, and in any case on request or when you stop selling on TownMart, unless the law requires you to keep it."] },
      { heading: "6. Sub-processors and transfers", body: ["Do not pass customer data to anyone else, or transfer it outside Nigeria, without TownMart's written permission."] },
      { heading: "7. Helping with requests", body: ["Help TownMart answer requests from people exercising their data rights, and pass on any such request you receive within 2 working days."] },
      { heading: "8. Audits", body: ["Give TownMart the information it reasonably needs to show compliance with this agreement and the NDPA."] },
    ],
  },
  {
    slug: "acceptable-use",
    title: "Acceptable Use Policy",
    summary: "What you must not do on TownMart.",
    sections: [
      {
        heading: "Don't",
        body: [
          [
            "Commit or attempt fraud, including fake orders, chargeback abuse or using someone else's payment details.",
            "Post fake, paid-for or misleading reviews, or review your own business.",
            "Harass, threaten or discriminate against other users, sellers or staff.",
            "Contact customers or sellers outside TownMart to avoid fees, or use their details for anything except the order.",
            "Scrape the site, overload it, probe it for weaknesses without permission, or get around rate limits and security checks.",
            "Upload malware, or content that is illegal or infringes someone's rights.",
          ],
        ],
      },
      { heading: "What happens if you do", body: ["We may remove content, cancel orders, suspend or close accounts, and report illegal activity to the authorities. We tell you why unless the law or an investigation prevents it."] },
      { heading: "Reporting security issues", body: ["If you find a security problem, email {{company.support_email}}. Please give us reasonable time to fix it before telling anyone else."] },
    ],
  },
  {
    slug: "accessibility",
    title: "Accessibility Statement",
    summary: "How we make TownMart usable for everyone, and how to tell us when it isn't.",
    sections: [
      { heading: "Our aim", body: ["We want everyone to be able to shop and sell on TownMart, including people who use screen readers, keyboard navigation, magnification or slow connections. We aim to meet the Web Content Accessibility Guidelines (WCAG) 2.2 at level AA."] },
      { heading: "What we do", body: [["Pages work with a keyboard and have visible focus.", "Images have text alternatives and colour is never the only way information is shown.", "Text can be enlarged without breaking the layout, and the site works on small phone screens.", "Pages are kept light so they load on slower mobile data."]] },
      { heading: "Known limits", body: ["Some seller-uploaded images and descriptions may not have good text alternatives. We remind sellers to add them."] },
      { heading: "Tell us", body: ["If something doesn't work for you, email {{company.support_email}} or call {{company.support_phone}}. We aim to reply within 5 working days."] },
    ],
  },
  {
    slug: "company",
    title: "Company Information",
    summary: "Who runs TownMart and how to reach us.",
    sections: [
      { heading: "Registered company", body: [["Registered name: {{company.legal_name}}", "RC number: {{company.rc_number}}", "Registered address: {{company.address}}"]] },
      { heading: "Contact", body: [["Customer support: {{company.support_email}}, {{company.support_phone}}", "Data Protection Officer: {{company.dpo_name}}, {{company.dpo_email}}"]] },
      { heading: "Regulators", body: ["Data protection: Nigeria Data Protection Commission (NDPC). Consumer protection: Federal Competition and Consumer Protection Commission (FCCPC)."] },
    ],
  },
];

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The template as HTML for `legal_documents.body_html`. */
export function templateHtml(t: LegalTemplate): string {
  return t.sections
    .map((s) => {
      const body = s.body.map((b) => (Array.isArray(b) ? `<ul>${b.map((li) => `<li>${escapeHtml(li)}</li>`).join("")}</ul>` : `<p>${escapeHtml(b)}</p>`)).join("");
      return `<h2>${escapeHtml(s.heading)}</h2>${body}`;
    })
    .join("");
}
