/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        discord: {
          dark: '#313338',
          darker: '#2b2d31',
          darkest: '#1e1f22',
          card: '#2b2d31',
          hover: '#35373c',
          active: '#404249',
          input: '#383a40',
          muted: '#949ba4',
          text: '#dbdee1',
          heading: '#f2f3f5',
          blurple: '#5865f2',
          'blurple-hover': '#4752c4',
          online: '#23a55a',
          danger: '#f23f43',
          warning: '#f0b232',
        }
      }
    },
  },
  plugins: [],
}
