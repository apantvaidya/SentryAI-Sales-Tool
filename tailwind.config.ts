import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-inter)", "Inter", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "sans-serif"]
      },
      colors: {
        // Primary text / near-black, tuned to Blueprint's cool dark gray.
        ink: "#1c2127",
        slatepanel: "#f6f7f9",
        // Blueprint-style dark navigation rail.
        rail: {
          DEFAULT: "#1c2127",
          raised: "#252a31",
          hover: "#2f343c",
          border: "#383e47"
        },
        // Brand accent — Palantir Blueprint "intent primary" blue scale.
        brand: {
          50: "#eef4fd",
          100: "#d6e5fb",
          200: "#a9c8f5",
          300: "#7aa8ee",
          400: "#4f8be6",
          500: "#2d72d2",
          600: "#215db0",
          700: "#184a90",
          800: "#15406f",
          900: "#102d4f"
        },
        // Retained green accent used by status badges across the app.
        sentry: {
          50: "#effcf8",
          100: "#d8f7ee",
          500: "#1aa37a",
          600: "#148466",
          700: "#10745a",
          800: "#0c5947",
          900: "#083b32"
        }
      },
      borderRadius: {
        DEFAULT: "4px",
        md: "5px",
        lg: "7px"
      },
      boxShadow: {
        soft: "0 1px 1px rgba(17, 20, 24, 0.04), 0 4px 12px rgba(17, 20, 24, 0.06)",
        "apple-control": "inset 0 0 0 1px rgba(17, 20, 24, 0.05)",
        rail: "1px 0 0 rgba(255, 255, 255, 0.04)",
        focus: "0 0 0 3px rgba(45, 114, 210, 0.25)"
      }
    }
  },
  plugins: []
};

export default config;
