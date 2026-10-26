/**
 * Demo catalogue for local development and review: categories, six sellers,
 * their products and services. Prices are in naira strings, as a seller would
 * type them; the seed runs them through the same validation as the dashboard.
 */

export type DemoCategory = { slug: string; name: string; kind: "product" | "service"; icon?: string; children: { slug: string; name: string }[] };

export const CATEGORIES: DemoCategory[] = [
  {
    slug: "groceries",
    name: "Groceries",
    kind: "product",
    icon: "🛒",
    children: [
      { slug: "rice-grains", name: "Rice & grains" },
      { slug: "cooking-oils", name: "Cooking oils" },
      { slug: "noodles-pasta", name: "Noodles & pasta" },
      { slug: "beverages", name: "Beverages" },
      { slug: "spices-seasoning", name: "Spices & seasoning" },
      { slug: "snacks", name: "Snacks & biscuits" },
    ],
  },
  {
    slug: "fashion",
    name: "Fashion",
    kind: "product",
    icon: "👗",
    children: [
      { slug: "womens-clothing", name: "Women's clothing" },
      { slug: "mens-clothing", name: "Men's clothing" },
      { slug: "shoes", name: "Shoes" },
      { slug: "bags-accessories", name: "Bags & accessories" },
      { slug: "fabrics", name: "Fabrics" },
    ],
  },
  {
    slug: "electronics",
    name: "Electronics",
    kind: "product",
    icon: "📱",
    children: [
      { slug: "phones-tablets", name: "Phones & tablets" },
      { slug: "computers", name: "Computers" },
      { slug: "phone-accessories", name: "Phone accessories" },
      { slug: "audio", name: "Audio" },
      { slug: "power", name: "Power & solar" },
    ],
  },
  {
    slug: "home",
    name: "Home",
    kind: "product",
    icon: "🛋️",
    children: [
      { slug: "kitchen", name: "Kitchen" },
      { slug: "cleaning-supplies", name: "Cleaning supplies" },
      { slug: "home-decor", name: "Home décor" },
    ],
  },
  {
    slug: "farm-produce",
    name: "Farm Produce",
    kind: "product",
    icon: "🌽",
    children: [
      { slug: "fresh-vegetables", name: "Fresh vegetables" },
      { slug: "tubers", name: "Yams & tubers" },
      { slug: "fish-meat", name: "Fish & meat" },
      { slug: "poultry-eggs", name: "Poultry & eggs" },
      { slug: "fruits", name: "Fruits" },
    ],
  },
  {
    slug: "beauty",
    name: "Beauty",
    kind: "product",
    icon: "💄",
    children: [
      { slug: "skincare", name: "Skincare" },
      { slug: "hair-care", name: "Hair care" },
      { slug: "fragrances", name: "Fragrances" },
    ],
  },
  {
    slug: "services",
    name: "Services",
    kind: "service",
    icon: "🧰",
    children: [
      { slug: "plumbing", name: "Plumbing" },
      { slug: "electrical", name: "Electrical" },
      { slug: "cleaning", name: "Cleaning" },
      { slug: "ac-repair", name: "AC & fridge repair" },
    ],
  },
  {
    slug: "artisans",
    name: "Artisans",
    kind: "service",
    icon: "🪡",
    children: [
      { slug: "tailoring", name: "Tailoring" },
      { slug: "carpentry", name: "Carpentry" },
      { slug: "shoemaking", name: "Shoe making & repair" },
      { slug: "hair-styling", name: "Hair styling" },
    ],
  },
];

export type DemoProduct = {
  title: string;
  category: string;
  brand?: string;
  tags?: string;
  unit?: "piece" | "kg" | "litre" | "crate" | "bag" | "pack";
  fractional?: boolean;
  price: string;
  compareAt?: string;
  stock: string;
  threshold?: string;
  description: string;
  perishable?: string;
  weightGrams?: number;
  /** One option, with an optional price per value. */
  option?: { name: string; values: string[]; prices?: string[]; stock?: string[] };
  /** A second option (e.g. Colour) multiplied with the first. */
  option2?: { name: string; values: string[] };
  images?: number;
};

export type DemoService = {
  title: string;
  category: string;
  pricing: "fixed" | "from" | "hourly" | "packages";
  price: string;
  duration: number;
  location: "on_site" | "at_provider" | "both";
  deposit?: number;
  confirm?: boolean;
  description: string;
  packages?: { name: string; price: string; duration: number; description: string }[];
  /** [weekday, "HH:MM", "HH:MM", slotMinutes, maxPerSlot] */
  hours: [number, string, string, number, number][];
  radiusKm?: number;
};

export type DemoSeller = {
  key: string;
  owner: { email: string; name: string; phone: string };
  business: {
    name: string;
    slug: string;
    type: "retailer" | "supermarket" | "vendor" | "merchant" | "producer" | "service_provider" | "artisan";
    cac?: string;
    state: string;
    lga: string;
    city: string;
    address: string;
    description: string;
    colour: string;
    sellsProducts: boolean;
    sellsServices: boolean;
    returnWindowDays: number;
    pickup?: boolean;
  };
  serviceLgas?: string[];
  products: DemoProduct[];
  services: DemoService[];
};

const WEEKDAYS_9_TO_5: DemoService["hours"] = [1, 2, 3, 4, 5].map((d) => [d, "09:00", "17:00", 60, 1]);

export const SELLERS: DemoSeller[] = [
  {
    key: "ikeja-supermarket",
    owner: { email: "adaeze@ikejafreshmart.ng", name: "Adaeze Okafor", phone: "08031234501" },
    business: {
      name: "Ikeja Fresh Mart",
      slug: "ikeja-fresh-mart",
      type: "supermarket",
      cac: "RC 1458230",
      state: "Lagos",
      lga: "Ikeja",
      city: "Ikeja",
      address: "14 Obafemi Awolowo Way, Ikeja",
      description: "Neighbourhood supermarket on Awolowo Way since 2012. Groceries, household essentials and toiletries, delivered same day across Ikeja, Maryland and Ogba.",
      colour: "#0F6B3E",
      sellsProducts: true,
      sellsServices: false,
      returnWindowDays: 3,
      pickup: true,
    },
    products: [
      { title: "Mama Gold Rice, 50 kg", category: "rice-grains", brand: "Mama Gold", tags: "rice, parboiled", unit: "bag", price: "78500", compareAt: "82000", stock: "40", description: "Premium long-grain parboiled rice. Stone-free and easy to cook.", weightGrams: 50000, images: 2 },
      { title: "Ofada Rice, 5 kg", category: "rice-grains", tags: "rice, local, ofada", unit: "bag", price: "9800", stock: "25", description: "Locally grown Ofada rice from Ogun State, destoned and packed in 5 kg bags.", weightGrams: 5000 },
      { title: "Honeywell Semovita, 2 kg", category: "rice-grains", brand: "Honeywell", tags: "semovita, swallow", unit: "pack", price: "3900", stock: "60", description: "Semolina for smooth, lump-free swallow.", weightGrams: 2000 },
      { title: "Kings Vegetable Oil", category: "cooking-oils", brand: "Kings", tags: "oil, vegetable oil", unit: "piece", price: "4200", stock: "50", description: "Cholesterol-free vegetable oil for frying and cooking.", option: { name: "Size", values: ["1 litre", "3 litres", "5 litres"], prices: ["4200", "11500", "18900"], stock: ["30", "20", "12"] } },
      { title: "Red Palm Oil, per litre", category: "cooking-oils", tags: "palm oil, local", unit: "litre", fractional: true, price: "2600", stock: "120.5", threshold: "10", description: "Fresh, unadulterated red palm oil from Imo, sold by the litre. Order half litres if you like." },
      { title: "Indomie Instant Noodles, carton of 40", category: "noodles-pasta", brand: "Indomie", tags: "noodles, carton", unit: "pack", price: "11200", compareAt: "12000", stock: "35", description: "Chicken flavour, 70 g packs, 40 in a carton.", option: { name: "Flavour", values: ["Chicken", "Onion Chicken", "Pepper Chicken"] } },
      { title: "Golden Penny Spaghetti, 500 g", category: "noodles-pasta", brand: "Golden Penny", tags: "pasta, spaghetti", unit: "pack", price: "1150", stock: "90", description: "Durum wheat spaghetti." },
      { title: "Milo Refill, 900 g", category: "beverages", brand: "Nestlé", tags: "milo, chocolate drink", unit: "pack", price: "6900", stock: "28", description: "Chocolate malt drink refill pack." },
      { title: "Peak Milk Powder, 400 g", category: "beverages", brand: "Peak", tags: "milk, powder", unit: "pack", price: "4300", stock: "4", threshold: "5", description: "Full cream milk powder in a resealable sachet." },
      { title: "Maggi Star Cubes, pack of 100", category: "spices-seasoning", brand: "Maggi", tags: "seasoning, cubes", unit: "pack", price: "1800", stock: "70", description: "The seasoning cube for soups and stews." },
      { title: "Plantain Chips, 6 pack", category: "snacks", tags: "snacks, plantain chips", unit: "pack", price: "2400", stock: "45", description: "Crunchy, lightly salted plantain chips made in Lagos.", perishable: "Best within 3 weeks of opening." },
      { title: "Hypo Bleach, 2 litres", category: "cleaning-supplies", brand: "Hypo", tags: "bleach, cleaning", unit: "piece", price: "2100", stock: "30", description: "Kills 99.9% of germs. For toilets, sinks and floors." },
      { title: "Non-stick Pot Set, 3 pieces", category: "kitchen", tags: "pots, cookware", unit: "pack", price: "34500", compareAt: "39000", stock: "6", description: "Three non-stick pots with glass lids: 18, 22 and 26 cm.", weightGrams: 4200, images: 2 },
      { title: "Shea Butter Body Cream, 500 ml", category: "skincare", tags: "shea butter, moisturiser", unit: "piece", price: "5200", stock: "22", description: "Rich body cream made with raw Nigerian shea butter." },
      { title: "Black Soap, 250 g", category: "skincare", tags: "black soap, ose dudu", unit: "piece", price: "1500", stock: "40", description: "Traditional African black soap (ose dudu)." },
      { title: "Hair Growth Oil, 120 ml", category: "hair-care", tags: "hair oil, natural hair", unit: "piece", price: "3800", stock: "18", description: "Blend of castor, coconut and rosemary oils for natural hair." },
      { title: "Oud Perfume Oil, 12 ml", category: "fragrances", tags: "perfume, oud, attar", unit: "piece", price: "6500", stock: "14", description: "Long-lasting alcohol-free perfume oil.", option: { name: "Scent", values: ["Oud Royal", "White Musk", "Rose"] } },
      { title: "Body Spray, 200 ml", category: "fragrances", tags: "body spray, deodorant", unit: "piece", price: "2900", stock: "36", description: "Fresh everyday body spray." },
      { title: "Scented Candle", category: "home-decor", tags: "candle, home fragrance", unit: "piece", price: "7800", stock: "10", description: "Soy wax candle in a glass jar, about 40 hours burn time.", option: { name: "Scent", values: ["Lemongrass", "Vanilla", "Sandalwood"] } },
      { title: "Throw Pillow Cover, ankara print", category: "home-decor", tags: "cushion, pillow, ankara", unit: "piece", price: "5500", stock: "20", description: "45 × 45 cm cotton cover with hidden zip. Insert not included." },
      { title: "Plastic Storage Bowls, set of 5", category: "kitchen", tags: "food storage, bowls", unit: "pack", price: "8900", stock: "15", description: "Airtight, microwave-safe bowls in five sizes." },
      { title: "Dettol Antiseptic Liquid, 750 ml", category: "cleaning-supplies", brand: "Dettol", tags: "antiseptic, disinfectant", unit: "piece", price: "5600", stock: "26", description: "For first aid, laundry and household cleaning." },
    ],
    services: [],
  },
  {
    key: "ogun-farm",
    owner: { email: "tunde@ogunharvest.ng", name: "Tunde Adebayo", phone: "08051234502" },
    business: {
      name: "Ogun Harvest Farms",
      slug: "ogun-harvest-farms",
      type: "producer",
      cac: "BN 2245781",
      state: "Ogun",
      lga: "Obafemi Owode",
      city: "Mowe",
      address: "Km 4 Ofada Road, Mowe",
      description: "Family farm in Mowe growing vegetables, tubers and catfish. We harvest to order and deliver to Lagos and Ogun three times a week.",
      colour: "#2E7D32",
      sellsProducts: true,
      sellsServices: false,
      returnWindowDays: 0,
      pickup: true,
    },
    products: [
      { title: "Fresh Tomatoes", category: "fresh-vegetables", tags: "tomatoes, fresh", unit: "kg", fractional: true, price: "1800", stock: "250", threshold: "20", description: "Ripe Roma tomatoes, harvested the morning of delivery. Sold by the kilo.", perishable: "Keeps 5 to 7 days in a cool place.", images: 2 },
      { title: "Tomatoes, big basket", category: "fresh-vegetables", tags: "tomatoes, basket, bulk", unit: "crate", price: "48000", stock: "12", description: "A full raffia basket of tomatoes (about 30 kg) for caterers and restaurants.", perishable: "Keeps 5 days in a cool place." },
      { title: "Scotch Bonnet Pepper (Ata Rodo)", category: "fresh-vegetables", tags: "pepper, ata rodo", unit: "kg", fractional: true, price: "3200", stock: "60.5", description: "Hot and fragrant scotch bonnet peppers.", perishable: "Keeps a week refrigerated." },
      { title: "Ugu Leaves, bunch", category: "fresh-vegetables", tags: "ugu, pumpkin leaves", unit: "piece", price: "700", stock: "80", description: "Fresh fluted pumpkin leaves, washed and bundled.", perishable: "Use within 3 days." },
      { title: "Puna Yam", category: "tubers", tags: "yam, puna", unit: "piece", price: "4500", stock: "70", description: "Large Puna yam tubers, about 3 kg each.", option: { name: "Size", values: ["Medium", "Large", "Extra large"], prices: ["3500", "4500", "6000"], stock: ["30", "25", "15"] }, images: 2 },
      { title: "Cassava Tubers", category: "tubers", tags: "cassava", unit: "bag", price: "15000", stock: "20", description: "50 kg bag of freshly uprooted cassava for garri and fufu.", perishable: "Process within 2 days." },
      { title: "Smoked Catfish", category: "fish-meat", tags: "catfish, smoked fish", unit: "piece", price: "3500", stock: "45", description: "Whole catfish, slow-smoked over hardwood.", option: { name: "Size", values: ["Medium", "Jumbo"], prices: ["3500", "5500"], stock: ["30", "15"] } },
      { title: "Live Catfish", category: "fish-meat", tags: "catfish, live", unit: "kg", fractional: true, price: "2800", stock: "300", threshold: "30", description: "Pond-raised catfish, sold live by weight. We can dress them on request.", perishable: "Delivered live; cook the same day." },
      { title: "Farm Eggs, crate of 30", category: "poultry-eggs", tags: "eggs, crate", unit: "crate", price: "5800", stock: "0", description: "Large brown eggs from free-range layers.", perishable: "Keeps 3 weeks." },
      { title: "Fresh Pineapple", category: "fruits", tags: "pineapple, fruit", unit: "piece", price: "1500", stock: "60", description: "Sweet Ogun pineapples, about 1.5 kg each.", perishable: "Ripe within 3 days." },
      { title: "Watermelon", category: "fruits", tags: "watermelon, fruit", unit: "piece", price: "3500", stock: "18", description: "Whole watermelons, 5 to 7 kg.", perishable: "Keeps a week uncut." },
      { title: "Broiler Chicken, dressed", category: "poultry-eggs", tags: "chicken, broiler", unit: "kg", fractional: true, price: "4800", stock: "85", threshold: "10", description: "Farm-raised broilers, cleaned and dressed. About 2 to 2.5 kg each.", perishable: "Keep frozen; use within 3 months." },
      { title: "Ripe Plantain, bunch", category: "fruits", tags: "plantain", unit: "piece", price: "6500", stock: "25", description: "A bunch of 12 to 15 fingers, ripening in 2 to 3 days.", perishable: "Ripens within a week." },
    ],
    services: [],
  },
  {
    key: "yaba-fashion",
    owner: { email: "bisola@yabathreads.ng", name: "Bisola Martins", phone: "08091234503" },
    business: {
      name: "Yaba Threads",
      slug: "yaba-threads",
      type: "vendor",
      cac: "BN 3317429",
      state: "Lagos",
      lga: "Lagos Mainland",
      city: "Yaba",
      address: "Shop 22, Tejuosho Market, Yaba",
      description: "Ankara, adire and everyday fashion from Tejuosho Market. Ready-to-wear in UK sizes 8 to 18, plus bags and shoes.",
      colour: "#B4235A",
      sellsProducts: true,
      sellsServices: false,
      returnWindowDays: 7,
    },
    products: [
      { title: "Ankara Wrap Dress", category: "womens-clothing", tags: "ankara, dress", unit: "piece", price: "18500", compareAt: "22000", stock: "0", description: "Midi wrap dress in bold ankara print, fully lined.", option: { name: "Size", values: ["8", "10", "12", "14", "16"], stock: ["3", "5", "5", "4", "2"] }, option2: { name: "Print", values: ["Blue Ripple", "Sunset"] }, images: 3 },
      { title: "Adire Kimono Jacket", category: "womens-clothing", tags: "adire, kimono", unit: "piece", price: "15000", stock: "0", description: "Hand-dyed adire from Abeokuta, cut into a relaxed kimono jacket.", option: { name: "Size", values: ["S/M", "L/XL"], stock: ["6", "4"] }, images: 2 },
      { title: "Women's Palazzo Trousers", category: "womens-clothing", tags: "trousers, palazzo", unit: "piece", price: "9500", stock: "0", description: "Wide-leg, high-waist trousers with an elastic back.", option: { name: "Size", values: ["10", "12", "14", "16"], stock: ["4", "6", "6", "3"] }, option2: { name: "Colour", values: ["Black", "Olive"] } },
      { title: "Men's Senator Kaftan", category: "mens-clothing", tags: "senator, kaftan, native", unit: "piece", price: "28000", stock: "0", description: "Two-piece senator style in breathable cotton blend.", option: { name: "Size", values: ["M", "L", "XL", "XXL"], stock: ["4", "6", "5", "2"] }, option2: { name: "Colour", values: ["Navy", "Wine", "Cream"] }, images: 2 },
      { title: "Men's Ankara Shirt, short sleeve", category: "mens-clothing", tags: "ankara, shirt", unit: "piece", price: "12000", stock: "0", description: "Casual short-sleeve shirt in ankara print.", option: { name: "Size", values: ["M", "L", "XL"], stock: ["5", "7", "4"] } },
      { title: "Leather Slides", category: "shoes", tags: "slides, leather, palm", unit: "piece", price: "14500", stock: "0", description: "Handmade leather slides from Aba.", option: { name: "Size", values: ["40", "41", "42", "43", "44", "45"], stock: ["2", "4", "5", "5", "3", "2"] }, option2: { name: "Colour", values: ["Brown", "Black"] } },
      { title: "Block-heel Sandals", category: "shoes", tags: "sandals, heels", unit: "piece", price: "16000", stock: "0", description: "Comfortable 5 cm block heel with an ankle strap.", option: { name: "Size", values: ["37", "38", "39", "40", "41"], stock: ["3", "4", "4", "3", "2"] } },
      { title: "Ankara Tote Bag", category: "bags-accessories", tags: "tote, ankara, bag", unit: "piece", price: "7500", stock: "18", description: "Roomy tote with inner zip pocket and leather handles." },
      { title: "Beaded Statement Necklace", category: "bags-accessories", tags: "beads, necklace, jewellery", unit: "piece", price: "6000", stock: "9", description: "Handmade coral-style bead necklace, adjustable length." },
      { title: "Ankara Fabric, 6 yards", category: "fabrics", tags: "ankara, fabric", unit: "piece", price: "13500", stock: "0", description: "100% cotton wax print, 6 yards.", option: { name: "Print", values: ["Peacock", "Kente Gold", "Blue Ripple", "Hibiscus"], stock: ["8", "6", "10", "5"] }, images: 2 },
      { title: "Aso-oke Set (gele and ipele)", category: "fabrics", tags: "aso oke, gele", unit: "pack", price: "45000", stock: "4", description: "Hand-woven aso-oke head tie and shoulder wrap set for owambe." },
      { title: "Silk Headwrap", category: "bags-accessories", tags: "headwrap, silk", unit: "piece", price: "4500", stock: "3", threshold: "3", description: "Soft satin-silk headwrap, 180 cm long." },
    ],
    services: [],
  },
  {
    key: "computer-village",
    owner: { email: "emeka@cvgadgets.ng", name: "Emeka Nwosu", phone: "08061234504" },
    business: {
      name: "CV Gadget Hub",
      slug: "cv-gadget-hub",
      type: "retailer",
      cac: "RC 1873304",
      state: "Lagos",
      lga: "Ikeja",
      city: "Computer Village, Ikeja",
      address: "Suite 8, 11 Otigba Street, Computer Village",
      description: "Phones, laptops and accessories from Otigba Street. Brand-new, sealed stock only, with a 6-month shop warranty on phones.",
      colour: "#1D4ED8",
      sellsProducts: true,
      sellsServices: false,
      returnWindowDays: 7,
      pickup: true,
    },
    products: [
      { title: "Samsung Galaxy A15", category: "phones-tablets", brand: "Samsung", tags: "samsung, android, phone", unit: "piece", price: "215000", stock: "0", description: "6.5-inch display, 50 MP camera, 5000 mAh battery. Sealed with one-year Samsung warranty.", option: { name: "Storage", values: ["128 GB", "256 GB"], prices: ["215000", "248000"], stock: ["6", "4"] }, option2: { name: "Colour", values: ["Black", "Light Blue"] }, images: 3 },
      { title: "Tecno Spark 20", category: "phones-tablets", brand: "Tecno", tags: "tecno, android, phone", unit: "piece", price: "165000", compareAt: "175000", stock: "0", description: "90 Hz display, 50 MP camera, 18 W fast charging.", option: { name: "Storage", values: ["128 GB", "256 GB"], prices: ["165000", "189000"], stock: ["8", "5"] }, images: 2 },
      { title: "Infinix Hot 40i", category: "phones-tablets", brand: "Infinix", tags: "infinix, android, phone", unit: "piece", price: "142000", stock: "10", description: "Budget-friendly phone with a big 5000 mAh battery." },
      { title: "iPhone 13, 128 GB (UK used)", category: "phones-tablets", brand: "Apple", tags: "iphone, apple, used", unit: "piece", price: "520000", stock: "0", description: "Clean UK-used iPhone 13, battery health 88% or more, fully tested.", option: { name: "Colour", values: ["Midnight", "Starlight", "Blue"], stock: ["2", "1", "1"] }, images: 2 },
      { title: "HP 250 G9 Laptop", category: "computers", brand: "HP", tags: "laptop, hp, windows", unit: "piece", price: "585000", stock: "0", description: "15.6-inch, Intel Core i5, Windows 11.", option: { name: "Memory", values: ["8 GB / 256 GB SSD", "16 GB / 512 GB SSD"], prices: ["585000", "690000"], stock: ["3", "2"] }, weightGrams: 1800, images: 2 },
      { title: "Lenovo IdeaPad Slim 3", category: "computers", brand: "Lenovo", tags: "laptop, lenovo", unit: "piece", price: "640000", stock: "2", threshold: "2", description: "Thin and light, AMD Ryzen 5, 8 GB RAM, 512 GB SSD.", weightGrams: 1600 },
      { title: "Oraimo 20,000 mAh Power Bank", category: "power", brand: "Oraimo", tags: "power bank, oraimo", unit: "piece", price: "21500", compareAt: "24000", stock: "30", description: "Charges a phone 4 to 5 times. Two USB outputs and USB-C in/out." },
      { title: "Fast Charger, 25 W USB-C", category: "phone-accessories", tags: "charger, usb-c", unit: "piece", price: "7500", stock: "45", description: "Wall charger with 1 m USB-C cable." },
      { title: "Tempered Glass Screen Protector", category: "phone-accessories", tags: "screen guard", unit: "piece", price: "2500", stock: "100", description: "9H hardness, full-glue edge to edge.", option: { name: "Model", values: ["Galaxy A15", "Spark 20", "iPhone 13"], stock: ["40", "35", "25"] } },
      { title: "Oraimo FreePods 4", category: "audio", brand: "Oraimo", tags: "earbuds, bluetooth", unit: "piece", price: "28000", stock: "15", description: "Wireless earbuds with active noise cancellation and 35-hour battery." },
      { title: "JBL Go 3 Bluetooth Speaker", category: "audio", brand: "JBL", tags: "speaker, jbl", unit: "piece", price: "39500", stock: "8", description: "Pocket speaker, waterproof (IP67).", option: { name: "Colour", values: ["Black", "Red", "Blue"], stock: ["3", "3", "2"] } },
      { title: "1 kVA Solar Inverter", category: "power", tags: "inverter, solar", unit: "piece", price: "265000", stock: "3", description: "Pure sine wave inverter with built-in MPPT charge controller.", weightGrams: 12000 },
    ],
    services: [],
  },
  {
    key: "plumber",
    owner: { email: "chukwudi@fixitplumbing.ng", name: "Chukwudi Eze", phone: "08021234505" },
    business: {
      name: "Chukwudi FixIt Plumbing",
      slug: "chukwudi-fixit-plumbing",
      type: "service_provider",
      state: "Lagos",
      lga: "Surulere",
      city: "Surulere",
      address: "7 Adeniran Ogunsanya Street, Surulere",
      description: "Licensed plumber with 12 years' experience in homes and offices across Lagos Mainland. Leaks, blockages, water heaters and pumping machines.",
      colour: "#0E7490",
      sellsProducts: false,
      sellsServices: true,
      returnWindowDays: 0,
    },
    serviceLgas: ["Surulere", "Lagos Mainland", "Ikeja", "Eti Osa"],
    products: [],
    services: [
      { title: "Leaking Pipe and Tap Repair", category: "plumbing", pricing: "from", price: "8000", duration: 60, location: "on_site", deposit: 0, description: "Fix dripping taps, leaking pipes and joints. Price covers labour; parts are quoted on site.", hours: [...WEEKDAYS_9_TO_5, [6, "10:00", "14:00", 60, 1]] },
      { title: "Blocked Drain and Toilet Clearing", category: "plumbing", pricing: "fixed", price: "15000", duration: 90, location: "on_site", deposit: 20, description: "Clearing of blocked sinks, toilets and floor drains with a drain snake.", hours: WEEKDAYS_9_TO_5 },
      { title: "Water Heater Installation", category: "plumbing", pricing: "packages", price: "25000", duration: 180, location: "on_site", deposit: 30, description: "Installation of electric water heaters with safety valve and connections.", packages: [
        { name: "Basic", price: "25000", duration: 120, description: "Mount and connect a heater you already have." },
        { name: "Standard", price: "40000", duration: 180, description: "Includes pipes, valves and fittings up to 3 m." },
        { name: "Premium", price: "65000", duration: 240, description: "Full re-pipe of one bathroom plus installation." },
      ], hours: WEEKDAYS_9_TO_5 },
      { title: "Pumping Machine Repair", category: "plumbing", pricing: "hourly", price: "6000", duration: 120, location: "on_site", deposit: 0, description: "Diagnosis and repair of surface pumps and borehole submersibles.", hours: [[1, "08:00", "16:00", 120, 1], [3, "08:00", "16:00", 120, 1], [5, "08:00", "16:00", 120, 1]] },
      { title: "Bathroom Fittings Installation", category: "plumbing", pricing: "from", price: "35000", duration: 300, location: "on_site", deposit: 30, description: "WC, wash-hand basin, shower and bathtub installation.", hours: WEEKDAYS_9_TO_5 },
    ],
  },
  {
    key: "tailor",
    owner: { email: "titi@mamatiti.ng", name: "Titilayo Ogunleye", phone: "08071234506" },
    business: {
      name: "Mama Titi Couture",
      slug: "mama-titi-couture",
      type: "artisan",
      state: "Oyo",
      lga: "Ibadan North",
      city: "Bodija, Ibadan",
      address: "3 Awolowo Avenue, Bodija",
      description: "Bespoke native wear and alterations in Bodija. Aso-ebi for weddings, corporate natives and children's outfits. Fittings at the shop or at your home in Ibadan.",
      colour: "#7C3AED",
      sellsProducts: false,
      sellsServices: true,
      returnWindowDays: 0,
    },
    serviceLgas: ["Ibadan North", "Ibadan North-East", "Ibadan North-West"],
    products: [],
    services: [
      { title: "Custom Native Outfit", category: "tailoring", pricing: "packages", price: "15000", duration: 60 * 24 * 7, location: "both", deposit: 50, description: "Made-to-measure buba and sokoto, iro and buba, or kaftan. You bring the fabric.", packages: [
        { name: "Basic", price: "15000", duration: 60 * 24 * 7, description: "Simple style, one piece." },
        { name: "Standard", price: "25000", duration: 60 * 24 * 7, description: "Two-piece outfit with embroidery on the neckline." },
        { name: "Premium", price: "45000", duration: 60 * 24 * 10, description: "Three-piece with hand beading and a fitting session." },
      ], hours: [[1, "09:00", "18:00", 30, 2], [2, "09:00", "18:00", 30, 2], [3, "09:00", "18:00", 30, 2], [4, "09:00", "18:00", 30, 2], [5, "09:00", "18:00", 30, 2], [6, "10:00", "16:00", 30, 2]] },
      { title: "Clothing Alterations", category: "tailoring", pricing: "from", price: "2500", duration: 30, location: "at_provider", deposit: 0, confirm: false, description: "Taking in, letting out, hemming and zip replacement. Most jobs ready in 2 days.", hours: [[1, "09:00", "18:00", 30, 3], [2, "09:00", "18:00", 30, 3], [3, "09:00", "18:00", 30, 3], [4, "09:00", "18:00", 30, 3], [5, "09:00", "18:00", 30, 3]] },
      { title: "Aso-ebi Group Sewing (per outfit)", category: "tailoring", pricing: "from", price: "18000", duration: 60 * 24 * 14, location: "both", deposit: 50, description: "Wedding and party aso-ebi for groups of 5 or more. Measurements taken at one sitting.", hours: [[6, "10:00", "16:00", 60, 1]] },
      { title: "Children's Native Wear", category: "tailoring", pricing: "fixed", price: "9000", duration: 60 * 24 * 5, location: "at_provider", deposit: 50, description: "Matching outfits for children aged 1 to 12.", hours: WEEKDAYS_9_TO_5 },
      { title: "Home Fitting Visit", category: "tailoring", pricing: "fixed", price: "5000", duration: 45, location: "on_site", deposit: 100, description: "We come to you for measurements or a final fitting anywhere in north Ibadan.", hours: [[2, "16:00", "19:00", 60, 1], [4, "16:00", "19:00", 60, 1], [6, "09:00", "13:00", 60, 1]], radiusKm: 15 },
    ],
  },
];

export type DemoPromotion = {
  name: string;
  description?: string;
  type: "percentage" | "fixed";
  /** Whole percent, or naira off each item. */
  value: string;
  scope: "store" | "product" | "products" | "category" | "service";
  products?: string[];
  services?: string[];
  categories?: string[];
  /** Runs from the hour the seed runs, for this many hours. */
  hours: number;
  flash?: boolean;
  coupon?: string;
  minOrder?: string;
  usageLimit?: string;
  perCustomerLimit?: string;
};

/** Demo promotions by store slug. */
export const PROMOTIONS: Record<string, DemoPromotion[]> = {
  "ikeja-fresh-mart": [
    { name: "Rice and grains flash sale", description: "15% off every bag of rice, semovita and grains.", type: "percentage", value: "15", scope: "category", categories: ["rice-grains"], hours: 48, flash: true },
    { name: "Welcome to Ikeja Fresh Mart", description: "10% off your first order of ₦20,000 or more.", type: "percentage", value: "10", scope: "store", hours: 24 * 30, coupon: "IKEJAFRESH10", minOrder: "20000", perCustomerLimit: "1" },
  ],
  "ogun-harvest-farms": [
    { name: "Tomato harvest deal", description: "Fresh from this morning's harvest.", type: "percentage", value: "20", scope: "product", products: ["Fresh Tomatoes"], hours: 24, flash: true, usageLimit: "100" },
  ],
  "yaba-threads": [
    { name: "Yaba Threads weekend code", description: "15% off when you spend ₦25,000 or more.", type: "percentage", value: "15", scope: "store", hours: 24 * 14, coupon: "YABA15", minOrder: "25000" },
    { name: "Ankara dress sale", type: "fixed", value: "2500", scope: "products", products: ["Ankara Wrap Dress", "Ankara Tote Bag"], hours: 24 * 7 },
  ],
  "cv-gadget-hub": [
    { name: "Gadget week", description: "Money off selected phones and accessories.", type: "fixed", value: "5000", scope: "products", products: ["Samsung Galaxy A15", "Oraimo 20,000 mAh Power Bank", "Oraimo FreePods 4"], hours: 24 * 7 },
  ],
  "chukwudi-fixit-plumbing": [
    { name: "Plumbing check-up offer", description: "10% off leak repairs and drain clearing this month.", type: "percentage", value: "10", scope: "service", services: ["Leaking Pipe and Tap Repair", "Blocked Drain and Toilet Clearing"], hours: 24 * 21 },
  ],
};
