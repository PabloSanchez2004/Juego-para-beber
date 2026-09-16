/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: [
    "./src/**/*.{html,ts,scss}"
  ],
  theme: {
    extend: {
      colors: {
        // Shadcn Design System Tokens
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },

        // Direct Palette Tokens
        ink: {
          950: "#0b0d17",
          900: "#121626",
          850: "#171c30",
          800: "#1c223a",
          700: "#273152",
          600: "#384570",
        },
        brand: {
          300: "#ff6b91",
          400: "#ff3d6e",
          500: "#ff1a53",
          600: "#d9043d",
        },
        neon: {
          coral: "#ff2a5f",
          mint: "#00f5a0",
          cyan: "#00e5ff",
          gold: "#ffd166",
          amber: "#ff9f1c",
          violet: "#a855f7",
        },
        gold: {
          300: "#ffe082",
          400: "#ffd166",
          500: "#ffb703",
        },
      },
      fontFamily: {
        sans: ["Outfit", "Plus Jakarta Sans", "Inter", "system-ui", "sans-serif"],
        display: ["Outfit", "Plus Jakarta Sans", "system-ui", "sans-serif"],
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        "2xl": "1rem",
        "3xl": "1.25rem",
      },
      boxShadow: {
        card: "0 4px 20px -2px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.05)",
        elevated: "0 10px 30px -4px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.08)",
        button: "0 4px 0 #b3002f, 0 10px 24px rgba(255, 42, 95, 0.35)",
        "glow-brand": "0 0 24px rgba(255, 42, 95, 0.4)",
        "glow-mint": "0 0 24px rgba(0, 245, 160, 0.35)",
        "glow-gold": "0 0 24px rgba(255, 209, 102, 0.35)",
        "inset-top": "inset 0 1px 0 rgba(255, 255, 255, 0.1)",
      },
      animation: {
        "pulse-fast": "pulse 0.8s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "bounce-slow": "bounce 2s infinite",
        "fade-in": "fadeIn 0.3s ease-in-out",
        "slide-up": "slideUp 0.4s ease-out",
        "pop-in": "popIn 0.35s cubic-bezier(0.2, 0.9, 0.3, 1.2)",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%": { transform: "translateY(20px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
        popIn: {
          "0%": { transform: "scale(0.9)", opacity: "0" },
          "100%": { transform: "scale(1)", opacity: "1" },
        },
      },
    },
  },
  plugins: [],
};
