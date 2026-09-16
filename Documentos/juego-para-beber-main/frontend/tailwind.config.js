/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{html,ts,scss}"
  ],
  theme: {
    extend: {
      colors: {
        // ── Paleta "Neon Velvet / Night Party" ──────────────────────────────
        // Superficies de noche de previa/fiesta: obsidian velvet profundo, con personalidad
        ink: {
          950: '#0b0d17', // Fondo principal de la app
          900: '#121626', // Tarjetas principales
          850: '#171c30', // Tarjetas intermedias
          800: '#1c223a', // Tarjetas elevadas / inputs / bloques secundarios
          700: '#273152', // Bordes nítidos y divisores
          600: '#384570', // Hover / bordes activos
        },
        // Acento de marca: Electric Punch / Neon Flame Pink (activo, divertido, fiestero)
        brand: {
          300: '#ff6b91',
          400: '#ff3d6e',
          500: '#ff1a53',
          600: '#d9043d',
        },
        // Acentos de energía del juego
        neon: {
          coral: '#ff2a5f',
          mint: '#00f5a0',
          cyan: '#00e5ff',
          gold: '#ffd166',
          amber: '#ff9f1c',
          violet: '#a855f7',
        },
        // Semánticos del podio y ranking
        gold: {
          300: '#ffe082',
          400: '#ffd166',
          500: '#ffb703',
        },
      },
      fontFamily: {
        sans: ['Outfit', 'Plus Jakarta Sans', 'Inter', 'system-ui', 'sans-serif'],
        display: ['Outfit', 'Plus Jakarta Sans', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.25rem',
      },
      boxShadow: {
        card: '0 4px 20px -2px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.05)',
        elevated: '0 10px 30px -4px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.08)',
        button: '0 4px 0 #b3002f, 0 10px 24px rgba(255, 42, 95, 0.35)',
        'glow-brand': '0 0 24px rgba(255, 42, 95, 0.4)',
        'glow-mint': '0 0 24px rgba(0, 245, 160, 0.35)',
        'glow-gold': '0 0 24px rgba(255, 209, 102, 0.35)',
        'inset-top': 'inset 0 1px 0 rgba(255, 255, 255, 0.1)',
      },
      animation: {
        'pulse-fast': 'pulse 0.8s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'bounce-slow': 'bounce 2s infinite',
        'fade-in': 'fadeIn 0.3s ease-in-out',
        'slide-up': 'slideUp 0.4s ease-out',
        'pop-in': 'popIn 0.35s cubic-bezier(0.2, 0.9, 0.3, 1.2)',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { transform: 'translateY(20px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        popIn: {
          '0%': { transform: 'scale(0.9)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
      },
    },
  },
  plugins: [],
};
