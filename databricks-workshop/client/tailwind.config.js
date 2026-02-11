/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        databricks: {
          red: "#FF3621",
          dark: "#1B3139",
          darker: "#0F1F25",
          slate: "#2D4550",
          light: "#E8ECEF",
        },
      },
    },
  },
  plugins: [],
};
