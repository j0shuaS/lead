/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // The five supplied colors, kept under their own names too so
        // they're traceable back to the palette.
        celadon: "#AFD5AA",
        whitesmoke: "#F0F2EF",
        stone: "#5C5346",
        silver: "#A69F98",
        smokyrose: "#8C6057",

        // Semantic aliases used throughout the components.
        paper: "#F0F2EF", // White Smoke
        ink: "#5C5346", // Stone Brown
        "ink-soft": "#A69F98", // Silver
        rule: "#DAD9D5", // a light tint between White Smoke and Silver
        signal: "#8C6057", // Smoky Rose — no-website / bad-website accent
        confirmed: "#AFD5AA", // Celadon — good-website accent
        okay: "#9D9A80", // Celadon/Smoky Rose blend — okay-website accent
      },
      fontFamily: {
        display: ["Fraunces", "Georgia", "serif"],
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["IBM Plex Mono", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};
