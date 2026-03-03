# FlowScale AI Design System

## 1. Introduction & Philosophy

This document serves as the single source of truth for the design system of FlowScale AI. It is intended to guide the development of all UI components, landing pages, and interactive elements within this project and future related projects.

**Core Philosophy:**
- **Technological & Modern:** The aesthetic is "Cyber-Tech" but refined. It evokes precision, high-performance computing, and advanced AI capabilities.
- **Dark Mode First:** The interface is built primarily for dark mode to reduce eye strain during long workflows and to make content (colors, graphs, nodes) pop.
- **Content-Centric:** The UI frames the content (generative workflows, images). The chrome is minimal and unobtrusive.
- **Motion as Feedback:** Use subtle, purposeful animations to indicate state and guide the user. Avoid gratuitous motion.

---

## 2. Global Token System

We utilize CSS variables defined in `globals.css` and extended via Tailwind CSS.

### 2.1 Colors

**Base Colors**

| Token | Value | Description |
| :--- | :--- | :--- |
| `--color-background` | `#09090b` | The deepest background color. Used for the body/page background. |
| `--color-background-panel` | `#121214` | Slightly lighter than background. Used for sidebars, cards, and modal backdrops. |
| `--color-background-canvas` | `#0c0c0e` | Dedicated background for the node canvas or heavy interactive areas. |
| `--color-foreground` | `#d4d4d8` | Primary text color. Readable but not harsh white. |

**Primary Accent**
- **Emerald** is the primary brand color, representing growth, correct execution, and "flow."
- Use tailwind colors: `emerald-400`, `emerald-500`, `emerald-600`.

**Neutral Scale**
- **Zinc** is used for all grays. It has a slight blue tint that works well with screens.
- `zinc-950`: heavy borders/backgrounds.
- `zinc-800`/`zinc-700`: borders and dividers.
- `zinc-500`/`zinc-400`: secondary text and icons.

### 2.2 Typography

We use a specific type scale to differentiate technical data from UI labels.

**Font Families**
1. **Sans (Primary UI):** `Inter` (`var(--font-inter)`)
   - Use for: General UI, body text, buttons, inputs.
2. **Tech/Display:** `Space Grotesk` (`var(--font-space-grotesk)`)
   - Use for: Headings, feature titles, "hero" numbers.
3. **Mono:** `JetBrains Mono` (`var(--font-jetbrains-mono)`)
   - Use for: Code snippets, IDs, technical values, coordinate displays.

**Type Scale (Mobile / Desktop)**
- **H1:** `4xl` / `6xl` (Tight tracking, `font-tech`)
- **H2:** `3xl` / `4xl`
- **H3:** `2xl` / `3xl`
- **Body:** `base` / `lg` (Relaxed leading)
- **Small/Label:** `sm` / `xs` (Medium weight)
- **Tiny:** `10px` (Uppercase, wide tracking `tracking-widest`, `font-mono`)

### 2.3 Spacing & Layout

- **Base Unit:** 4px (Tailwind standard).
- **Container:** Max-width `7xl` (`1280px`) centered with `px-6 md:px-12`.
- **Corner Radius:**
  - `rounded-md` (6px): Buttons, inputs, small cards.
  - `rounded-lg` (8px): Standard cards, dialogs.
  - `rounded-xl` (12px): Large containers, floating panels.

---

## 3. Component Guidelines

### 3.1 Buttons

**Primary Button**
- Background: `bg-zinc-100` hover: `bg-white`
- Text: `text-black`
- Font: Semibold, `text-sm`
- Decoration: Subtle shadow/glow.

**Secondary Button**
- Background: `bg-zinc-900`
- Border: `border-zinc-800` hover: `border-zinc-600`
- Text: `text-zinc-300`

**Ghost/Icon Button**
- Background: Transparent
- Text: `text-zinc-400` hover: `text-white`
- Transitions: `transition-colors`

### 3.2 Cards & Panels

- **Background:** `bg-[#18181b]` or `bg-[#111113]` with `backdrop-blur` if overlaying content.
- **Border:** `border border-white/5` or `border border-zinc-800`.
- **Shadow:** `shadow-lg` or specific glow `shadow-[0_20px_50px_rgba(0,0,0,0.5)]` for floating elements.

### 3.3 Inputs

- Background: Transparent or very dark `bg-zinc-950`.
- Border: `border-zinc-800` focus: `border-emerald-500/50`.
- Text: `text-sm`, `font-sans`.
- Placeholder: `text-zinc-600`.

---

## 4. Visual Effects & Animations

### 4.1 Gradients & Glows

- Use subtle gradients for text emphasis: `bg-gradient-to-r from-emerald-200 via-emerald-400 to-emerald-600`.
- Use "beams" or flowing gradients for connecting lines in the node graph.

### 4.2 Custom Animations (`tailwind.config.ts`)

These animations are defined in `globals.css` and extended in Tailwind.

- **`animate-float`**: A gentle vertical hover for floating cards.
- **`animate-pulse`**: Standard opacity pulse for status indicators.
- **`animate-beam`**: Used for stroke-dashoffset animation on svg connection lines to simulate data execution flow.

### 4.3 Background Patterns

- **Grid:** A subtle 40px x 40px grid used on the canvas and large application backgrounds to give structure.
  ```css
  .bg-grid-pattern {
    background-image: linear-gradient(...), linear-gradient(...);
    background-size: 40px 40px;
  }
  ```

---

## 5. Iconography

- **Library:** Iconify (using React components).
- **Primary Set:** Solar (`solar:*-linear`, `solar:*-bold`).
- **Tech Stack Logos:** Simple Icons (`simple-icons:*`).
- **Sizing:**
  - Small/Inline: `16px` or `18px`.
  - Standard UI: `20px` or `24px`.
  - Hero/Feature: `32px`+.
- **Color:** Icons typically inherit text color or use `text-zinc-500` for inactive and `text-emerald-400` for active states.

---

## 6. Code Style & Structure

When implementing new components:
1. **"Use Client"**: Only when interactivity is needed.
2. **Imports**: Group imports (React -> Next -> Feature -> UI).
3. **Props**: Define interfaces clearly.
4. **Tailwind**: Use utility classes. For complex conditional logic, use `clsx` or `tailwind-merge` if available (check `src/lib/utils` or import directly).

---

## 7. Accessibility

- Maintain sufficient contrast ratios (text-zinc-400 on zinc-900 is the minimum for secondary text).
- Ensure interactive elements have focus states (handled via Tailwind default `focus:ring`).
- Use semantic HTML (`<button>`, `<nav>`, `<main>`).

---

## 8. Specific UI Patterns (Studio & OS)

Based on the actual implementation across the `os` and `studio` apps, adhere to the following specific patterns:

### 8.1 Layout Chrome (Sidebars & TopBars)
- **Positioning:** Use `fixed` or `sticky` with high z-index (`z-50`).
- **Backgrounds:** Use solid `bg-background-panel` for edge-anchored sidebars, or `bg-background` with a bottom border `border-white/10` for top bars.
- **Dynamic Sidebars:** Sidebars should transition width (e.g., `w-18` to `w-64`) on hover, applying `shadow-2xl shadow-black/50` when expanded over canvas content.
- **Navigation Items:** 
  - Inactive: `text-zinc-400 hover:bg-white/5 hover:text-zinc-100`.
  - Active: `bg-white/5 text-emerald-400`.
  - Icons should have a subtle scale effect on hover (`group-hover:scale-110`).

### 8.2 Floating Toolbars & Context Menus
- **Backdrops:** Heavily rely on `bg-zinc-900/90 backdrop-blur-md` for floating elements over the canvas.
- **Borders & Shadows:** `border border-white/10` and `shadow-xl`.
- **Active Tools:** When a tool or menu item is selected, use `bg-emerald-500/20 text-emerald-400`.

### 8.3 Interactive Cards
- **Resting State:** `bg-zinc-900/50 border border-white/5`.
- **Hover State:** Pronounced effects are standard. Use `hover:bg-zinc-900 hover:border-emerald-500/30 hover:shadow-xl hover:shadow-emerald-900/10 hover:-translate-y-1`.
- **Destructive Actions:** Use `text-red-400` and `bg-red-500/10 hover:bg-red-500/20`.

### 8.4 UI Utilities
- **Scrollbars:** Use `.no-scrollbar` utility (hides webkit scrollbars) in tool panels and sidebars while maintaining scroll functionality.
- **Tooltips:** Icon-only buttons (especially in floating toolbars) MUST be wrapped in a `<Tooltip>` component with a reasonable delay (e.g., `delay={600}`).
- **Data Display:** Use `.font-tech` for headers/titles and `.font-mono` (or `.font-mono-custom`) for technical data, dates, or small contextual badges.
