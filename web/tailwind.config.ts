import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          50: '#f3f6ff',
          100: '#e0e7ff',
          200: '#bec6ff',
          300: '#99a3ff',
          400: '#7a83ff',
          500: '#5f64f5',
          600: '#464cdb',
          700: '#3437b0',
          800: '#1f2277',
          900: '#0f123c',
          950: '#070a24',
        },
        aurora: {
          DEFAULT: '#5EF0FF',
          dark: '#2BBAC8',
        },
      },
      fontFamily: {
        sans: ['Inter', 'Inter var', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        glow: '0 20px 70px rgba(94, 240, 255, 0.18)',
      },
      backdropBlur: {
        xs: '2px',
      },
      borderRadius: {
        xl: '1.5rem',
      },
    },
  },
  plugins: [],
};

export default config;

