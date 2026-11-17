/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        canvas: '#090B10',
        surface: '#0F131C',
        'surface-elevated': '#161B26',
        card: '#161B26',
        input: '#121620',
        border: 'rgba(255, 255, 255, 0.07)',
        'border-active': 'rgba(99, 102, 241, 0.4)',
        accent: {
          DEFAULT: '#6366F1',
          hover: '#4F46E5',
          muted: 'rgba(99, 102, 241, 0.15)',
        },
        online: '#10B981',
        danger: {
          DEFAULT: '#EF4444',
          hover: '#DC2626',
          muted: 'rgba(239, 68, 68, 0.15)',
        },
        warning: {
          DEFAULT: '#F59E0B',
          muted: 'rgba(245, 158, 11, 0.15)',
        },
        text: {
          primary: '#F8FAFC',
          secondary: '#94A3B8',
          muted: '#64748B',
        },
      },
      fontFamily: {
        sans: [
          'Inter',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Roboto',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
}
