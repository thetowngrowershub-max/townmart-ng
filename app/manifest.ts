import type { MetadataRoute } from "next";

/** Lets phones add TownMart to the home screen with the cart icon. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TownMart",
    short_name: "TownMart",
    description: "Everything your town sells, in one place.",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#0F6B3E",
    icons: [
      { src: "/brand/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/brand/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
