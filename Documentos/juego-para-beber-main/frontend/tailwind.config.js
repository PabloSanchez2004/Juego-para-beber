/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{html,ts,scss}"
  ],
  theme: {
    extend: {
      colors: {
        // ── Paleta "premium dark" ─────────────────────────────────────
        // Superficies: azul-gris muy oscuro, sin negro puro ni neón.
        ink: {
          950: '#0b1020', // fondo de la app
          900: '#121a2f', // tarjetas
          800: '#1a2340', // tarjetas elevadas / inputs / botón secundario
          700: '#25304f', // bordes marcados, hover
          600: '#33405f',
        },
        // Acento de marca: azul suave. Se usa con moderación (CTA, foco).
        brand: {
          300: '#a3bcff',
          400: '#7aa0f7',
          500: '#5b86ee',
          600: '#4a6fd2',
        },
        // Semánticos del ranking
        gold: {
          300: '#fde68a',
          400: '#fbbf24',
          500: '#f59e0b',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.25rem',
      },
      boxShadow: {
        // Sombras suaves de elevación (sin glow)
        card: '0 1px 2px rgba(0, 0, 0, 0.35), 0 10px 30px -14px rgba(0, 0, 0, 0.6)',
        elevated: '0 2px 4px rgba(0, 0, 0, 0.35), 0 20px 40px -20px rgba(0, 0, 0, 0.7)',
        button: '0 6px 20px -8px rgba(91, 134, 238, 0.55)',
        'inset-top': 'inset 0 1px 0 rgba(255, 255, 255, 0.06)',
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
