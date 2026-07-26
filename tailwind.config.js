/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      fontSize: {
        "3xl": "2.5rem",
        base: "1.2rem",
      },
    },
  },
  plugins: [],
};
