/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './*.html',
    './*.js'
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        'app-dark': '#1a0b0b',
        'app-card': '#241212',
        'app-red': '#b71c1c',
        'app-gold': '#fbbf24',
        'app-green': '#25D366',
        'taxi-yellow': '#F7C948',
        'grill-dark': '#2E1E1E',
        'grill-red': '#A52A2A',
        'grill-accent': '#FF8C00',
        'grill-green': '#25D366'
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif']
      },
      animation: {
        'bounce-slow': 'bounce 3s infinite'
      },
      screens: {
        xs: '375px'
      }
    }
  }
};
