/** @type {import('tailwindcss').Config} */
export default {
  content: ['./public/**/*.html', './public/js/**/*.js'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#fff1f2',
          100: '#ffe4e6',
          500: '#ff2f35',
          600: '#e11d2e',
          700: '#b91c2b',
          900: '#450a0a'
        },
        signal: {
          400: '#ffd329',
          500: '#ffd329',
          600: '#e7b900'
        }
      }
    }
  },
  plugins: []
}
