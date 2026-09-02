/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  // "class" with no toggle = the app always renders the white/light theme.
  // (dark: variants stay in source for a future opt-in toggle)
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "Inter Variable",
          "Inter",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
        display: ["Nunito Variable", "Nunito", "Inter Variable", "sans-serif"],
      },
      colors: {
        accent: {
          50: "#f4f1ff",
          100: "#ebe4ff",
          200: "#d9cdff",
          300: "#bfa6ff",
          400: "#a074fb",
          500: "#8b4df5",
          600: "#7c2fe8",
          700: "#6c21cc",
          800: "#5a1ca7",
          900: "#4b1a87",
          950: "#2e0e5c",
        },
        brand: {
          50: "#eef4ff",
          100: "#dce6fd",
          200: "#c0d2fc",
          300: "#95b4f9",
          400: "#638cf4",
          500: "#3e64ee",
          600: "#2946e2",
          700: "#2136cf",
          800: "#202ea8",
          900: "#1f2b85",
          950: "#171d51",
        },
      },
      boxShadow: {
        card: "0 1px 2px rgb(15 23 42 / 0.04), 0 4px 16px -4px rgb(15 23 42 / 0.06)",
        "card-hover": "0 2px 4px rgb(15 23 42 / 0.05), 0 12px 28px -8px rgb(15 23 42 / 0.12)",
        fab: "0 8px 24px -6px rgb(41 70 226 / 0.5), 0 2px 6px rgb(41 70 226 / 0.3)",
        sheet: "0 -8px 40px -12px rgb(15 23 42 / 0.25)",
      },
      keyframes: {
        "fade-up": {
          from: { opacity: "0", transform: "translateY(10px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "sheet-up": {
          from: { transform: "translateY(100%)" },
          to: { transform: "translateY(0)" },
        },
        "scale-in": {
          from: { opacity: "0", transform: "scale(0.95)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
        "toast-in": {
          from: { opacity: "0", transform: "translateY(12px) scale(0.97)" },
          to: { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        shimmer: {
          from: { backgroundPosition: "200% 0" },
          to: { backgroundPosition: "-200% 0" },
        },
        "scan-sweep": {
          "0%": { top: "8%" },
          "50%": { top: "88%" },
          "100%": { top: "8%" },
        },
        "pop-check": {
          "0%": { transform: "scale(0.4)", opacity: "0" },
          "60%": { transform: "scale(1.08)", opacity: "1" },
          "100%": { transform: "scale(1)", opacity: "1" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.35s cubic-bezier(0.21, 1.02, 0.73, 1) both",
        "fade-in": "fade-in 0.2s ease-out both",
        "sheet-up": "sheet-up 0.32s cubic-bezier(0.32, 0.72, 0, 1) both",
        "scale-in": "scale-in 0.18s cubic-bezier(0.21, 1.02, 0.73, 1) both",
        "toast-in": "toast-in 0.25s cubic-bezier(0.21, 1.02, 0.73, 1) both",
        shimmer: "shimmer 1.8s linear infinite",
        "scan-sweep": "scan-sweep 2.6s ease-in-out infinite",
        "pop-check": "pop-check 0.45s cubic-bezier(0.21, 1.02, 0.73, 1) both",
      },
    },
  },
  plugins: [],
};
