import { DPA_VERSION, PROMOTIONS_TERMS_VERSION, REFUND_POLICY_VERSION, SELLER_AGREEMENT_VERSION, TERMS_VERSION } from "./legal";

/**
 * Draft texts sellers accept at onboarding and shoppers accept at checkout. Phase 6 replaces
 * these with versioned, admin-editable legal documents reviewed by counsel;
 * the version strings recorded on each business stay valid references.
 */
export type LegalDraft = { title: string; version: string; summary: string; sections: { heading: string; body: string[] }[] };

export const LEGAL_DRAFTS: Record<string, LegalDraft> = {
  terms: {
    title: "Terms of Use",
    version: TERMS_VERSION,
    summary: "The rules for using TownMart and buying from sellers on it.",
    sections: [
      { heading: "1. About TownMart", body: ["TownMart is an online marketplace in Nigeria. Independent sellers list products and services; TownMart runs the platform, takes payments on their behalf and helps resolve problems. When you buy, your contract for the item is with the seller."] },
      { heading: "2. Your account", body: ["You can buy as a guest or with an account. Keep your sign-in details private and tell us straight away if you think someone else has used your account. You must be 18 or over, or have a parent's or guardian's permission, to place an order."] },
      { heading: "3. Prices and fees", body: ["Prices are in naira and include any discounts shown. At checkout we show, before you pay, the item total, discounts, delivery fees for each seller, TownMart's service fee and VAT on that fee. The total you see is the total you pay.", "If a price or fee changes while you are checking out, we tell you the new total and ask you to confirm it before taking payment."] },
      { heading: "4. Payment", body: ["Online payments are processed by our payment partners (Paystack or Flutterwave). TownMart never sees or stores your full card details. Where a seller offers pay on delivery, you pay the rider or seller when the order arrives.", "Items are held for you for a short time while you pay. If payment doesn't arrive in that time the order is cancelled and the items go back on sale. If you are charged for an order that was cancelled, we refund you in full."] },
      { heading: "5. Delivery and pickup", body: ["Each seller delivers or offers pickup separately, so one checkout may arrive in several parcels. Delivery times are estimates in working days and depend on your location."] },
      { heading: "6. Returns and refunds", body: ["Our Refund Policy explains when and how you can return an item or get your money back. It does not limit your rights under the Federal Competition and Consumer Protection Act 2018."] },
      { heading: "7. Using TownMart fairly", body: ["Don't misuse the site: no fraud, fake orders or reviews, scraping, or attempts to get around our security. We may cancel orders or close accounts that do."] },
      { heading: "8. Your data", body: ["We handle your personal data as our Privacy Policy explains, in line with the Nigeria Data Protection Act 2023. Sellers receive only what they need to fulfil your order."] },
      { heading: "9. Changes", body: ["We may update these terms. The version you accepted is recorded on each order and applies to that order."] },
    ],
  },
  refunds: {
    title: "Refund & Returns Policy",
    version: REFUND_POLICY_VERSION,
    summary: "When you can return an item, cancel an order or get your money back.",
    sections: [
      { heading: "1. Before it ships", body: ["You can ask to cancel an order until the seller marks it as shipped or ready for pickup. Paid orders cancelled this way are refunded in full, including delivery and the service fee."] },
      { heading: "2. Returns", body: ["Each seller sets a return window, shown on the product page and at checkout, counted from delivery. Items must be unused and in their original packaging, unless they arrived damaged, faulty or not as described.", "Perishable goods such as fresh food can only be returned if they arrive spoiled or not as described, and you must tell us within 24 hours of delivery."] },
      { heading: "3. Damaged, faulty or wrong items", body: ["If an item arrives damaged, faulty or isn't what you ordered, report it with photos within the return window. You get a full refund or replacement, including the cost of returning it."] },
      { heading: "4. How refunds are paid", body: ["Refunds go back to the way you paid: to your card or bank account for online payments, or by bank transfer for pay on delivery. We start the refund within 2 working days of approving it; your bank may take up to 10 working days to show it.", "If you used a coupon or promotion, you get back what you actually paid for the item."] },
      { heading: "5. Payments we can't match", body: ["If you are charged twice, or pay after an order has been cancelled and the item is no longer available, we refund the payment in full."] },
      { heading: "6. Disputes", body: ["If you and a seller can't agree, TownMart reviews the case and decides. We hold the seller's payment until the order is delivered and the return window has passed, so refunds we approve are paid."] },
      { heading: "7. Your legal rights", body: ["This policy adds to, and does not reduce, your rights under the Federal Competition and Consumer Protection Act 2018."] },
    ],
  },
  "seller-agreement": {
    title: "Seller Agreement",
    version: SELLER_AGREEMENT_VERSION,
    summary: "The terms for selling products or services on TownMart.",
    sections: [
      { heading: "1. Who this is between", body: ["This agreement is between you (the seller) and TownMart, the operator of the TownMart marketplace in Nigeria. By accepting it during onboarding you confirm you can bind your business."] },
      { heading: "2. Your listings", body: ["You must own or be allowed to sell what you list, describe it accurately, keep prices and stock up to date, and follow our Prohibited Items policy.", "You are responsible for the quality, safety and legality of your products and services, including any licences your trade needs."] },
      { heading: "3. Orders, payments and payouts", body: ["Customers pay TownMart through our payment provider. We hold the payment until the order is delivered or the service is completed, then pay you, minus our commission and any refunds, to your verified bank account.", "Commission rates are shown in your dashboard before they apply. We give at least 14 days' notice of increases."] },
      { heading: "4. Fulfilment and returns", body: ["You must fulfil orders within the time you advertise and honour the return window you set, as well as customers' rights under the Federal Competition and Consumer Protection Act 2018."] },
      { heading: "5. Customer data", body: ["You receive customer names, phone numbers and addresses only to fulfil orders and bookings. You process them under the Data Processing Agreement and must not use them for marketing without the customer's consent."] },
      { heading: "6. Verification and suspension", body: ["We verify your identity and bank account before approval. We may suspend or remove listings or your store for breaches of this agreement, fraud, or repeated customer complaints, and will tell you why."] },
      { heading: "7. Changes", body: ["We may update this agreement. Material changes are announced in your dashboard and by email, and you will be asked to accept the new version."] },
    ],
  },
  dpa: {
    title: "Data Processing Agreement",
    version: DPA_VERSION,
    summary: "How sellers must handle personal data they receive through TownMart, under the Nigeria Data Protection Act 2023.",
    sections: [
      { heading: "1. Roles", body: ["For order fulfilment, TownMart is the data controller and you process customer personal data on our behalf and only on our documented instructions."] },
      { heading: "2. What you may do", body: ["Use customer details only to deliver orders, perform booked services, and handle returns and complaints for those orders."] },
      { heading: "3. Security", body: ["Keep customer data confidential, limit access to staff who need it, and protect it with appropriate technical and organisational measures."] },
      { heading: "4. Breaches", body: ["Tell TownMart without undue delay, and within 24 hours, if you become aware of a personal data breach involving TownMart customers, so we can meet our 72-hour duty to notify the Nigeria Data Protection Commission."] },
      { heading: "5. Retention and deletion", body: ["Delete or return customer data when you no longer need it for the order, and in any case on request or when you stop selling on TownMart, unless the law requires you to keep it."] },
      { heading: "6. Sub-processors and transfers", body: ["Do not pass customer data to anyone else, or transfer it outside Nigeria, without TownMart's written permission."] },
      { heading: "7. Audits", body: ["Give TownMart the information it reasonably needs to show compliance with this agreement and the NDPA."] },
    ],
  },
  "prohibited-items": {
    title: "Prohibited Items",
    version: SELLER_AGREEMENT_VERSION,
    summary: "What can't be sold or offered on TownMart.",
    sections: [
      {
        heading: "Not allowed",
        body: [
          "Weapons, ammunition and explosives; illegal drugs and drug paraphernalia; prescription-only medicines and unregistered drugs or cosmetics (NAFDAC registration required where applicable).",
          "Counterfeit or stolen goods; items that infringe trademarks or copyright; government IDs, documents or uniforms.",
          "Live wild animals and protected species or their parts; human remains or organs.",
          "Adult content and services; gambling; financial products that need a licence you don't hold.",
          "Hazardous chemicals and anything banned from sale by Nigerian law or the Nigeria Customs Service import prohibition list.",
        ],
      },
      { heading: "Enforcement", body: ["Listings that break this policy are removed. Repeated or serious breaches lead to suspension and may be reported to the authorities."] },
    ],
  },
  promotions: {
    title: "Promotions & Coupon Terms",
    version: PROMOTIONS_TERMS_VERSION,
    summary: "How discounts, flash deals and coupon codes work on TownMart, for shoppers and sellers.",
    sections: [
      {
        heading: "1. Who runs a promotion",
        body: [
          "Most promotions are run by the seller named on the listing, who pays for the discount. TownMart may also run platform-wide promotions, which say so.",
          "The seller sets the discount, what it covers, when it starts and ends (Lagos time), and any limits. TownMart may end a promotion that breaks these terms.",
        ],
      },
      {
        heading: "2. Honest prices",
        body: [
          "A discounted price must be a real reduction from the price the item normally sells for on TownMart. Sellers must not raise a price just before a promotion to make the discount look bigger.",
          "Every promotion shows its real end date and time. TownMart does not show fake countdowns or fake stock warnings.",
          "Flash deals last no more than 72 hours.",
        ],
      },
      {
        heading: "3. How discounts are worked out",
        body: [
          "Each item gets the single best discount it qualifies for. A coupon code replaces that discount if the coupon is better, unless the seller allows the code to be combined, in which case it is taken off the already-discounted price.",
          "Prices never go below ₦0. Discounts are rounded to the nearest kobo. Delivery fees are not discounted unless the promotion says so.",
          "A minimum order means the value of that seller's items in your cart, before discounts.",
        ],
      },
      {
        heading: "4. Coupon codes",
        body: [
          "A code works only for the promotion it belongs to, during its dates, and up to any total or per-customer limit. Codes have no cash value and can't be exchanged or transferred for payment.",
          "We may refuse or reverse a discount obtained by fraud, by abusing limits (for example with several accounts), or because of an obvious pricing error, and will tell you why.",
        ],
      },
      {
        heading: "5. Refunds and returns",
        body: [
          "If you return a discounted item, you are refunded what you actually paid for it. If returning part of an order means you no longer meet a minimum order, the refund is reduced by the discount that no longer applies.",
          "Your rights under the Federal Competition and Consumer Protection Act 2018 are not affected by any promotion.",
        ],
      },
      {
        heading: "6. Changes and ending early",
        body: [
          "A seller may pause or end a promotion early. Orders already placed keep the price shown at checkout.",
        ],
      },
    ],
  },
};
