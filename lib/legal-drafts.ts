import { DPA_VERSION, SELLER_AGREEMENT_VERSION } from "./legal";

/**
 * Draft texts sellers read before accepting at onboarding. Phase 6 replaces
 * these with versioned, admin-editable legal documents reviewed by counsel;
 * the version strings recorded on each business stay valid references.
 */
export type LegalDraft = { title: string; version: string; summary: string; sections: { heading: string; body: string[] }[] };

export const LEGAL_DRAFTS: Record<string, LegalDraft> = {
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
};
