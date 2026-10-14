/**
 * List of available font names — used to generate dynamic font classes (e.g., `font-inter`, `font-manrope`).
 *
 * 「设置 → 外观」页已删除（2026-09-15），字体由 `FontProvider` 应用并持久化，
 * 界面不再提供字体切换入口；这份名单保留给 Provider 的取值校验与默认字体。
 *
 * How to Add a New Font (Tailwind v4+):
 * 1. Add the font name here.
 * 2. Update the `<link>` tag in 'index.html' to include the new font from Google Fonts (or any other source).
 * 3. Add the new font family to 'index.css' using the `@theme inline` and `font-family` CSS variable.
 *
 * Example:
 * fonts.ts           -> Add 'roboto' to this array.
 * index.html         -> Add Google Fonts link for Roboto.
 * index.css          -> Add the new font in the CSS, e.g.:
 *   @theme inline {
 *      // ... other font families
 *      --font-roboto: 'Roboto', var(--font-sans);
 *   }
 */
export const fonts = ['inter', 'manrope', 'system'] as const
