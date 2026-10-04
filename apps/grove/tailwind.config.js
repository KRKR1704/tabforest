/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './landing/index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        serif: ['Lora', 'Georgia', 'serif'],
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      colors: {
        forest: {
          50: '#f2f8f4',
          100: '#e1efe6',
          200: '#c5decb',
          300: '#9bc4a5',
          400: '#6ea57c',
          500: '#4c875b',
          600: '#3a6c47',
          700: '#2f5539',
          800: '#1b3322',
          900: '#0f2015',
          950: '#07120a',
        },
        moss: {
          light: '#a3c293',
          DEFAULT: '#729861',
          dark: '#4f6d41',
        },
        amberCanopy: {
          light: '#f5c26b',
          DEFAULT: '#d9822b',
          dark: '#a85b13',
        },
        bark: {
          50: '#f9f6f3',
          100: '#efeae4',
          200: '#dfd5cb',
          300: '#c7b6a6',
          400: '#a8937e',
          500: '#8b745e',
          600: '#715c4a',
          700: '#5c4a3b',
          800: '#46382e',
          900: '#2d241d',
        },
        fog: {
          light: 'rgba(230, 240, 235, 0.45)',
          DEFAULT: 'rgba(210, 225, 218, 0.75)',
          dense: 'rgba(180, 200, 192, 0.92)',
        },
        stoneGray: {
          light: '#cfd8dc',
          DEFAULT: '#78909c',
          dark: '#455a64',
        },
        firefly: {
          glow: '#fff7a0',
          DEFAULT: '#ffd54f',
          dark: '#f57f17',
        },
      },
      boxShadow: {
        'glow-leaf': '0 0 12px rgba(110, 165, 124, 0.6)',
        'glow-firefly': '0 0 16px rgba(255, 213, 79, 0.8)',
        'subtle-panel': '0 4px 20px -2px rgba(15, 32, 21, 0.08)',
      },
    },
  },
  plugins: [],
};
