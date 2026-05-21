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
        ink: "#172033",
        slatepanel: "#f6f8fb",
        sentry: {
          50: "#effcf8",
          100: "#d8f7ee",
          500: "#1aa37a",
          700: "#10745a",
          900: "#083b32"
        }
      },
      boxShadow: {
        soft: "0 16px 44px rgba(25, 38, 65, 0.08)"
      }
    }
  },
  plugins: []
};

export default config;
