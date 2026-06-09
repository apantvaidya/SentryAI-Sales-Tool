import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      colors: {
        ink: "#1d1d1f",
        slatepanel: "#f5f5f7",
        sentry: {
          50: "#effcf8",
          100: "#d8f7ee",
          600: "#148466",
          500: "#1aa37a",
          700: "#10745a",
          900: "#083b32"
        }
      },
      boxShadow: {
        soft: "0 18px 42px rgba(0, 0, 0, 0.055)",
        "apple-control": "0 1px 2px rgba(0, 0, 0, 0.04)"
      }
    }
  },
  plugins: []
};

export default config;
